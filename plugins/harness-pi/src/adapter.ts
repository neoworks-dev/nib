import { readFile } from "node:fs/promises";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
  AgentSession,
  CreateAgentSessionOptions,
  ModelRuntime,
  PromptOptions,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  attachmentMetadata,
  composeAttachmentPrompt,
  type CreateSessionOptions,
  type EmitEvent,
  type HarnessAdapter,
  type HarnessSession,
  type ModelInfo,
  type SessionAttachment,
  type SlashCommandInfo,
} from "@nib-ui/protocol";
import {
  composeModelId,
  createPiStreamState,
  mapPiEvent,
  parseCommands,
  parseModels,
  piCapabilities,
  piDefaultModel,
  piHarnessId,
  piModels,
  type PiStreamState,
  queueUserAttachments,
  splitModelId,
} from "./mapping";

/** pi gates tools for the whole run rather than putting a session into a mode. */
const permissionModeLabel = "unrestricted";

/**
 * Everything the deployment decides about one mount. Mounting the package twice
 * under different ids gives two harnesses backed by the same agent.
 */
export interface PiHarnessConfig {
  /** Id the adapter registers under; also the key for icons and stored default models. */
  harnessId?: string;
  displayName?: string;
  /** pi's global config directory; defaults to `~/.pi/agent`. */
  agentDir?: string;
  /** `provider/modelId`, or `default` to keep whatever pi's own settings select. */
  defaultModel?: string;
  /** Allowlist of tool names. Omitted leaves pi on its own default tool set. */
  tools?: string[];
  excludeTools?: string[];
}

interface ResumeOptions {
  nativeSessionId: string;
  fork?: boolean;
}

export function createPiAdapter(config: PiHarnessConfig): HarnessAdapter {
  const harnessId = config.harnessId ?? piHarnessId;
  return {
    id: harnessId,
    displayName: config.displayName ?? "pi",
    capabilities: piCapabilities,
    defaultPermissionMode: permissionModeLabel,
    models: piModels,
    defaultModel: config.defaultModel ?? piDefaultModel.id,
    createSession: (opts, emit) => startSession(harnessId, config, opts, emit),
    resumeSession: (nativeSessionId, opts, emit) =>
      startSession(harnessId, config, opts, emit, { nativeSessionId, fork: opts.fork }),
  };
}

async function startSession(
  harnessId: string,
  config: PiHarnessConfig,
  opts: CreateSessionOptions,
  emit: EmitEvent,
  resume?: ResumeOptions,
): Promise<HarnessSession> {
  // Dynamic so the SDK never lands in a bundle that the client could pull in.
  const sdk = await import("@earendil-works/pi-coding-agent");
  const modelRuntime = await sdk.ModelRuntime.create();
  const sessionManager = await openSessionManager(sdk, opts.cwd, resume);

  const sessionOptions: CreateAgentSessionOptions = { cwd: opts.cwd, modelRuntime, sessionManager };
  if (config.agentDir) sessionOptions.agentDir = config.agentDir;
  if (config.tools) sessionOptions.tools = config.tools;
  if (config.excludeTools) sessionOptions.excludeTools = config.excludeTools;
  const selected = selectModel(modelRuntime, config, opts.options);
  if (selected) sessionOptions.model = selected;

  const { session, modelFallbackMessage } = await sdk.createAgentSession(sessionOptions);

  let state: PiStreamState = createPiStreamState(opts.cwd, session.sessionId, harnessId);
  let disposed = false;

  emit({
    type: "session.created",
    data: {
      harnessId,
      cwd: opts.cwd,
      nativeSessionId: session.sessionId,
      capabilities: piCapabilities,
    },
  });
  emit({
    type: "session.meta",
    data: {
      permissionMode: permissionModeLabel,
      effort: session.thinkingLevel,
      model: describeCurrentModel(session),
      slashCommands: readCommands(session),
    },
  });
  if (modelFallbackMessage) {
    emit({ type: "log", data: { level: "warn", message: modelFallbackMessage } });
  }

  void publishModels(modelRuntime, emit);

  const unsubscribe = session.subscribe((event) => {
    if (disposed) return;
    const mapped = mapPiEvent(state, event);
    state = mapped.state;
    for (const emitted of mapped.events) emit(emitted);
  });

  return {
    async send(text, attachments = []) {
      // pi takes images natively and opens anything else with its own tools, so
      // only the non-image attachments become path references in the prompt.
      const { images, referenced } = await readImages(attachments, emit);
      const prompt = composeAttachmentPrompt(text, referenced);
      // pi replays the prompt on the event stream after expanding skills and
      // templates, so the metadata waits for that echo instead of a local one.
      state = queueUserAttachments(state, attachmentMetadata(attachments));
      emit({ type: "session.status", data: { status: "working" } });

      const promptOptions: PromptOptions = {};
      if (images.length > 0) promptOptions.images = images;
      // Required while a run is in flight, and rejected as ambiguous otherwise.
      if (session.isStreaming) promptOptions.streamingBehavior = "steer";

      // `prompt()` resolves only once the whole run finishes; awaiting it here
      // would hold the command channel open for the length of the turn.
      void session.prompt(prompt, promptOptions).catch((error: unknown) => {
        if (disposed) return;
        emit({ type: "session.status", data: { status: "error", detail: describeError(error) } });
      });
    },

    async interrupt() {
      await session.abort();
      emit({ type: "log", data: { level: "info", message: "interrupt requested" } });
    },

    respondToPermission(requestId) {
      emit({
        type: "log",
        data: {
          level: "debug",
          message: `pi does not request permissions; ignoring response to ${requestId}`,
        },
      });
    },

    async setModel(model) {
      const resolved = resolveModel(modelRuntime, model);
      if (!resolved) throw new Error(`unknown pi model "${model}"`);
      await session.setModel(resolved);
      emit({ type: "session.meta", data: { model } });
    },

    // Not `async`: pi applies a thinking level synchronously, and the interface
    // only asks for a promise back.
    setEffort(effort) {
      // Matching against the reported levels narrows to pi's own union, so the
      // level reaches `setThinkingLevel` without a cast.
      const level = session.getAvailableThinkingLevels().find((candidate) => candidate === effort);
      if (!level) throw new Error(`unknown pi thinking level "${effort}"`);
      session.setThinkingLevel(level);
      emit({ type: "session.meta", data: { effort } });
      return Promise.resolve();
    },

    dispose() {
      disposed = true;
      unsubscribe();
      session.dispose();
      return Promise.resolve();
    },
  };
}

type PiSdk = typeof import("@earendil-works/pi-coding-agent");

/**
 * A native session id names a file pi wrote, and only the listing maps one to
 * the other. A fork copies that file's history into a new session, so the
 * parent keeps its own transcript.
 */
async function openSessionManager(
  sdk: PiSdk,
  cwd: string,
  resume: ResumeOptions | undefined,
): Promise<SessionManager> {
  if (!resume) return sdk.SessionManager.create(cwd);

  const sessions = await sdk.SessionManager.listAll();
  const match = sessions.find((entry) => entry.id === resume.nativeSessionId);
  if (!match) throw new Error(`pi has no session with id "${resume.nativeSessionId}"`);
  if (resume.fork) return sdk.SessionManager.forkFrom(match.path, cwd);
  return sdk.SessionManager.open(match.path);
}

/** Undefined for `default`, so pi keeps whatever its own settings select. */
function selectModel(
  modelRuntime: ModelRuntime,
  config: PiHarnessConfig,
  options: Record<string, unknown> | undefined,
): ReturnType<ModelRuntime["getModel"]> {
  const requested = readModelOption(options) ?? config.defaultModel;
  if (!requested || requested === piDefaultModel.id) return undefined;
  return resolveModel(modelRuntime, requested);
}

function readModelOption(options: Record<string, unknown> | undefined): string | undefined {
  const model = options?.model;
  return typeof model === "string" ? model : undefined;
}

function resolveModel(
  modelRuntime: ModelRuntime,
  id: string,
): ReturnType<ModelRuntime["getModel"]> {
  const split = splitModelId(id);
  if (!split) return undefined;
  return modelRuntime.getModel(split.provider, split.modelId);
}

function describeCurrentModel(session: AgentSession): string | undefined {
  const model = session.model;
  if (!model) return undefined;
  return composeModelId(model.provider, model.id);
}

/** Extension commands, prompt templates and skills all reach the composer as `/name`. */
function readCommands(session: AgentSession): SlashCommandInfo[] {
  const commands = [
    ...session.extensionRunner.getRegisteredCommands().map((command) => ({
      name: command.invocationName,
      description: command.description,
    })),
    ...session.promptTemplates.map((template) => ({
      name: template.name,
      description: template.description,
    })),
    ...session.resourceLoader.getSkills().skills.map((skill) => ({
      name: `skill:${skill.name}`,
      description: skill.description,
    })),
  ];
  return parseCommands({ commands });
}

/**
 * Only the models that have working authentication reach the composer; the
 * static list stands in until this answers, and a failure leaves it in place.
 */
async function publishModels(modelRuntime: ModelRuntime, emit: EmitEvent): Promise<void> {
  try {
    const available = await modelRuntime.getAvailable();
    const models: ModelInfo[] = parseModels({ models: available });
    if (models.length === 0) return;
    emit({ type: "session.meta", data: { models: [piDefaultModel, ...models] } });
  } catch (error) {
    emit({
      type: "log",
      data: { level: "debug", message: `pi model probe failed: ${describeError(error)}` },
    });
  }
}

/**
 * Splits the attachments into what the model can look at and what it has to open.
 * An image whose bytes cannot be read falls back to a path reference rather than
 * dropping out of the prompt.
 */
async function readImages(
  attachments: readonly SessionAttachment[],
  emit: EmitEvent,
): Promise<{ images: ImageContent[]; referenced: SessionAttachment[] }> {
  const images: ImageContent[] = [];
  const referenced: SessionAttachment[] = [];
  for (const attachment of attachments) {
    if (!attachment.mime.startsWith("image/")) {
      referenced.push(attachment);
      continue;
    }
    try {
      const data = (await readFile(attachment.path)).toString("base64");
      images.push({ type: "image", data, mimeType: attachment.mime });
    } catch (error) {
      emit({
        type: "log",
        data: {
          level: "warn",
          message: `attachment "${attachment.name}" was sent as a path: ${describeError(error)}`,
        },
      });
      referenced.push(attachment);
    }
  }
  return { images, referenced };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
