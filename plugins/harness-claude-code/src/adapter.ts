import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CanUseTool,
  EffortLevel,
  Options,
  PermissionMode,
  PermissionResult,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  agentControlInstructions,
  comfyInstructions,
  agentControlServerName,
  agentToolTimeoutSeconds,
  attachmentMetadata,
  composeAttachmentPrompt,
  type CreateSessionOptions,
  type EmitEvent,
  type HarnessAdapter,
  type HarnessSession,
  type PermissionBehavior,
  type SessionAttachment,
} from "@nib-ui/protocol";
import { vaultInstructions, VAULT_DIRECTORY } from "@nib-ui/vault";
import { resolveClaudeExecutable } from "./binary";
import {
  ClaudeMessageMapper,
  claudeCodeCapabilities,
  claudeCodeHarnessId,
  claudeCodeModels,
} from "./mapping";
import { AsyncMessageQueue } from "./message-queue";

interface PermissionResponse {
  behavior: PermissionBehavior;
  updatedInput?: unknown;
}

interface ResumeOptions {
  nativeSessionId: string;
  fork?: boolean;
}

/**
 * Everything the deployment decides about one mount. Mounting the package twice
 * under different ids gives two harnesses backed by the same CLI.
 */
export interface ClaudeCodeHarnessConfig {
  /** Id the adapter registers under; also the key for icons and stored default models. */
  harnessId?: string;
  displayName?: string;
  /** Absolute path to the CLI, taking precedence over `CLAUDE_EXECUTABLE` and PATH. */
  executable?: string;
  defaultModel?: string;
  defaultPermissionMode?: string;
}

export function createClaudeCodeAdapter(config: ClaudeCodeHarnessConfig): HarnessAdapter {
  const harnessId = config.harnessId ?? claudeCodeHarnessId;
  return {
    id: harnessId,
    displayName: config.displayName ?? "Claude Code",
    capabilities: claudeCodeCapabilities,
    defaultPermissionMode: config.defaultPermissionMode ?? "default",
    models: claudeCodeModels,
    defaultModel: config.defaultModel ?? "default",
    createSession: (opts, emit) => startSession(harnessId, config, opts, emit),
    resumeSession: (nativeSessionId, opts, emit) =>
      startSession(harnessId, config, opts, emit, { nativeSessionId, fork: opts.fork }),
  };
}

async function startSession(
  harnessId: string,
  config: ClaudeCodeHarnessConfig,
  opts: CreateSessionOptions,
  emit: EmitEvent,
  resume?: ResumeOptions,
): Promise<HarnessSession> {
  const executable = resolveClaudeExecutable(config.executable);
  // Dynamic so the SDK never lands in a bundle that the client could pull in.
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const queue = new AsyncMessageQueue<SDKUserMessage>();
  const abortController = new AbortController();
  const mapper = new ClaudeMessageMapper(emit, opts.cwd, harnessId);
  const pending = new Map<string, (result: PermissionResult) => void>();
  const answeredEarly = new Map<string, PermissionResponse>();
  const answered = new Set<string>();
  let disposed = false;

  const canUseTool: CanUseTool = (toolName, input, options) => {
    const requestId = options.requestId;
    const early = answeredEarly.get(requestId);
    if (early) {
      answeredEarly.delete(requestId);
      return Promise.resolve(toPermissionResult(early));
    }
    // The resolver is registered before the event goes out: a transport that
    // answers synchronously (the smoke script, an auto-allow policy) would
    // otherwise resolve a request that has no pending entry yet.
    return new Promise<PermissionResult>((resolve) => {
      pending.set(requestId, resolve);
      emit({ type: "session.status", data: { status: "awaiting-permission" } });
      emit({
        type: "permission.requested",
        data: { requestId, toolName, input, suggestions: options.suggestions },
        raw: describeRequest(options),
      });
    });
  };

  const session: Query = query({
    prompt: queue,
    options: {
      ...withAgentControl(opts),
      cwd: opts.cwd,
      abortController,
      includePartialMessages: true,
      // Snapshots each turn's writes, which is what makes undoing a turn possible.
      enableFileCheckpointing: true,
      pathToClaudeCodeExecutable: executable,
      canUseTool,
      // The SDK's default, pinned: the project's own `.claude/` and its CLAUDE.md
      // are part of what the model is being pointed at, and should not depend on
      // an SDK default staying what it is.
      settingSources: ["user", "project", "local"],
      ...(resume ? { resume: resume.nativeSessionId, forkSession: resume.fork } : {}),
    },
  });

  void publishMetadata(session, emit);

  const pump = (async () => {
    for await (const message of session) mapper.handle(message);
  })().catch((error: unknown) => {
    if (disposed) return;
    emit({ type: "session.status", data: { status: "error", detail: describeError(error) } });
  });

  return {
    async send(text, attachments = []) {
      // The prompt carries its own uuid so the turn has a rewind target from
      // the moment it is sent, without depending on the CLI replaying it back.
      const messageId = crypto.randomUUID();
      // The model sees an attached image itself; everything else it has to open,
      // so only the rest of the attachments become path references in the text.
      const { images, referenced } = await readImageBlocks(attachments, emit);
      const prompt = composeAttachmentPrompt(text, referenced);
      mapper.emitUserText(prompt, messageId, attachmentMetadata(attachments));
      queue.push({
        type: "user",
        uuid: messageId,
        message: { role: "user", content: userContent(prompt, images) },
        parent_tool_use_id: null,
      });
      emit({ type: "session.status", data: { status: "working" } });
    },

    async interrupt() {
      await session.interrupt();
      emit({ type: "log", data: { level: "info", message: "interrupt requested" } });
    },

    respondToPermission(requestId, response) {
      if (answered.has(requestId)) return;
      answered.add(requestId);
      emit({
        type: "permission.resolved",
        data: {
          requestId,
          behavior: response.behavior,
          updatedInput: response.updatedInput,
          resolvedBy: "user",
        },
      });
      emit({ type: "session.status", data: { status: "working" } });

      const resolve = pending.get(requestId);
      if (!resolve) return void answeredEarly.set(requestId, response);
      pending.delete(requestId);
      resolve(toPermissionResult(response));
    },

    async setPermissionMode(mode) {
      await session.setPermissionMode(mode as PermissionMode);
      emit({ type: "session.meta", data: { permissionMode: mode } });
    },

    async setModel(model) {
      await session.setModel(model);
      emit({ type: "session.meta", data: { model } });
    },

    async setEffort(effort) {
      await session.applyFlagSettings({ effortLevel: effort as EffortLevel });
      emit({ type: "session.meta", data: { effort } });
    },

    async rewind(checkpointId) {
      const result = await session.rewindFiles(checkpointId);
      return {
        ok: result.canRewind && !result.error,
        filesChanged: result.filesChanged ?? [],
        error: result.error,
      };
    },

    async dispose() {
      disposed = true;
      queue.close();
      session.close();
      abortController.abort();
      await pump;
    },
  };
}

/**
 * The caller's options plus what every session is told. The vault rules are
 * appended to the preset rather than substituted, so the preset's prompt-caching
 * prefix survives; not a caller option, since a session that was never told the
 * format writes a vault nothing can read back (PLAN §8). With an agent-control
 * link, the `nib` server is merged into whatever MCP servers the caller already
 * names, and the model is told to spawn through it rather than through the
 * CLI's own Agent tool.
 */
export function withAgentControl(opts: CreateSessionOptions): Options {
  const options = opts.options as Options | undefined;
  const vault = vaultInstructions(join(opts.cwd, VAULT_DIRECTORY));
  if (!opts.agentControl) {
    return { ...options, systemPrompt: { type: "preset", preset: "claude_code", append: vault } };
  }
  return {
    ...options,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `${vault}\n\n${agentControlInstructions}\n\n${comfyInstructions}`,
    },
    mcpServers: {
      ...options?.mcpServers,
      [agentControlServerName]: {
        type: "http",
        url: opts.agentControl.url,
        timeout: agentToolTimeoutSeconds * 1000,
      },
    },
  };
}

/**
 * `supportedCommands`/`supportedModels` are control requests, so they only
 * answer once the CLI is up; a failure downgrades the composer to the harness
 * defaults instead of failing the session. The permission mode is deliberately
 * not republished here — the user may have changed it while the probe was open.
 */
async function publishMetadata(session: Query, emit: EmitEvent): Promise<void> {
  try {
    const [commands, models] = await Promise.all([
      session.supportedCommands(),
      session.supportedModels(),
    ]);
    emit({
      type: "session.meta",
      data: {
        slashCommands: commands.map((command) => ({
          name: command.name,
          description: command.description,
          argumentHint: command.argumentHint,
        })),
        models: models.map((model) => ({
          id: model.value,
          displayName: model.displayName,
          description: model.description,
        })),
      },
      raw: { commands, models },
    });
  } catch (error) {
    emit({
      type: "log",
      data: { level: "debug", message: `capability probe failed: ${describeError(error)}` },
    });
  }
}

type UserContent = SDKUserMessage["message"]["content"];
type ImageBlock = Extract<Exclude<UserContent, string>[number], { type: "image" }>;
type ImageMediaType = Extract<ImageBlock["source"], { type: "base64" }>["media_type"];

/** The API rejects an empty text block, so a prompt that is only images carries none. */
function userContent(prompt: string, images: ImageBlock[]): UserContent {
  if (images.length === 0) return prompt;
  if (prompt.length === 0) return images;
  return [...images, { type: "text", text: prompt }];
}

/** The media types the Messages API accepts as an image block; the rest are files. */
function nativeMediaType(mime: string): ImageMediaType | null {
  return mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/gif" ||
    mime === "image/webp"
    ? mime
    : null;
}

/**
 * Splits the attachments into what the model can look at and what it has to open.
 * An image whose bytes cannot be read falls back to a path reference rather than
 * dropping out of the prompt.
 */
async function readImageBlocks(
  attachments: readonly SessionAttachment[],
  emit: EmitEvent,
): Promise<{ images: ImageBlock[]; referenced: SessionAttachment[] }> {
  const images: ImageBlock[] = [];
  const referenced: SessionAttachment[] = [];
  for (const attachment of attachments) {
    const mediaType = nativeMediaType(attachment.mime);
    if (!mediaType) {
      referenced.push(attachment);
      continue;
    }
    try {
      const data = (await readFile(attachment.path)).toString("base64");
      images.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
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

function toPermissionResult(response: PermissionResponse): PermissionResult {
  if (response.behavior === "deny") return { behavior: "deny", message: "Denied by the user" };
  const updatedInput = response.updatedInput as Record<string, unknown> | undefined;
  return updatedInput ? { behavior: "allow", updatedInput } : { behavior: "allow" };
}

/** The raw options carry an AbortSignal, which cannot go into the JSONL log. */
function describeRequest(options: Parameters<CanUseTool>[2]): Record<string, unknown> {
  const { signal: _signal, ...rest } = options;
  return rest;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
