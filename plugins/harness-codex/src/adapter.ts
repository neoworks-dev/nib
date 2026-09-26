import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CodexOptions, SandboxMode, Thread, ThreadOptions } from "@openai/codex-sdk";
import {
  agentControlServerName,
  agentToolTimeoutSeconds,
  attachmentMetadata,
  composeAttachmentPrompt,
  type CreateSessionOptions,
  type EmitEvent,
  type HarnessAdapter,
  type HarnessSession,
  listOnce,
  type ModelInfo,
} from "@nib-ui/protocol";
import { appServerRequest } from "./app-server";
import { resolveCodexExecutable } from "./binary";
import {
  type CodexStreamState,
  codexCapabilities,
  codexDefaultModel,
  codexHarnessId,
  codexModels,
  createCodexStreamState,
  mapCodexEvent,
  mapUserText,
  parseModelCache,
  parseModelList,
} from "./mapping";

const sandboxModes: SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
const defaultSandboxMode: SandboxMode = "workspace-write";

/**
 * Everything the deployment decides about one mount. Mounting the package twice
 * under different ids gives two harnesses backed by the same CLI.
 */
export interface CodexHarnessConfig {
  /** Id the adapter registers under; also the key for icons and stored default models. */
  harnessId?: string;
  displayName?: string;
  /** Absolute path to the CLI, taking precedence over `CODEX_EXECUTABLE` and PATH. */
  executable?: string;
  defaultModel?: string;
  sandboxMode?: SandboxMode;
}

export function createCodexAdapter(config: CodexHarnessConfig): HarnessAdapter {
  const harnessId = config.harnessId ?? codexHarnessId;
  const listModels = listOnce(() => discoverModels(config));
  return {
    id: harnessId,
    displayName: config.displayName ?? "Codex",
    capabilities: codexCapabilities,
    defaultPermissionMode: config.sandboxMode ?? defaultSandboxMode,
    models: codexModels,
    defaultModel: config.defaultModel ?? codexDefaultModel.id,
    listModels,
    createSession: (opts, emit) => startSession(harnessId, config, opts, emit, listModels),
    resumeSession: (nativeSessionId, opts, emit) => {
      if (opts.fork) throw new Error("codex cannot fork a thread");
      return startSession(harnessId, config, opts, emit, listModels, nativeSessionId);
    },
  };
}

async function startSession(
  harnessId: string,
  config: CodexHarnessConfig,
  opts: CreateSessionOptions,
  emit: EmitEvent,
  listModels: () => Promise<ModelInfo[]>,
  resumeThreadId?: string,
): Promise<HarnessSession> {
  const executable = resolveCodexExecutable(config.executable);
  // Dynamic so the SDK never lands in a bundle that the client could pull in.
  const { Codex } = await import("@openai/codex-sdk");
  const codex = new Codex(codexOptions(executable, opts));
  const mountSandboxMode = config.sandboxMode ?? defaultSandboxMode;

  let threadOptions: ThreadOptions = {
    workingDirectory: opts.cwd,
    sandboxMode: readSandboxMode(opts.options) ?? mountSandboxMode,
    // The workspace picker offers any directory, and Codex otherwise refuses to
    // start outside a repository.
    skipGitRepoCheck: true,
    // Nothing can answer an approval prompt on a non-interactive stream, so any
    // other policy stalls the turn instead of escalating to the user.
    approvalPolicy: "never",
    ...readModelOption(opts.options),
  };
  let thread: Thread = resumeThreadId
    ? codex.resumeThread(resumeThreadId, threadOptions)
    : codex.startThread(threadOptions);

  let state: CodexStreamState = createCodexStreamState(
    opts.cwd,
    resumeThreadId ?? null,
    harnessId,
    resumeThreadId ? attachPrefix() : undefined,
  );
  let turns: Promise<void> = Promise.resolve();
  let currentTurn: AbortController | null = null;
  let disposed = false;

  // A resumed thread only announces its id again on the next `thread.started`,
  // so the log would lose the native id until the user sends something.
  if (resumeThreadId) {
    emit({
      type: "session.created",
      data: {
        harnessId,
        cwd: opts.cwd,
        nativeSessionId: resumeThreadId,
        capabilities: codexCapabilities,
      },
    });
  }

  void publishModels(listModels, emit);

  const runTurn = async (text: string): Promise<void> => {
    const abort = new AbortController();
    currentTurn = abort;
    try {
      const { events } = await thread.runStreamed(text, { signal: abort.signal });
      for await (const event of events) {
        const mapped = mapCodexEvent(state, event);
        state = mapped.state;
        for (const emitted of mapped.events) emit(emitted);
      }
    } catch (error) {
      if (disposed) return;
      if (abort.signal.aborted) {
        emit({ type: "session.status", data: { status: "idle", detail: "interrupted" } });
        return;
      }
      emit({ type: "session.status", data: { status: "error", detail: describeError(error) } });
    } finally {
      if (currentTurn === abort) currentTurn = null;
    }
  };

  const rebuildThread = () => {
    const threadId = thread.id ?? state.threadId;
    thread = threadId
      ? codex.resumeThread(threadId, threadOptions)
      : codex.startThread(threadOptions);
  };

  return {
    async send(text, attachments = []) {
      // Codex takes a single prompt string, so an attachment travels as the path
      // its bytes are stored at and the model opens it with its own tools.
      const prompt = composeAttachmentPrompt(text, attachments);
      const echo = mapUserText(state, prompt, attachmentMetadata(attachments));
      state = echo.state;
      for (const event of echo.events) emit(event);
      // Codex owns one turn at a time; queueing keeps a second send from
      // racing the generator of the turn already in flight.
      turns = turns.then(() => runTurn(prompt));
    },

    async interrupt() {
      currentTurn?.abort();
      emit({ type: "log", data: { level: "info", message: "interrupt requested" } });
    },

    respondToPermission(requestId) {
      emit({
        type: "log",
        data: {
          level: "debug",
          message: `codex does not request permissions; ignoring response to ${requestId}`,
        },
      });
    },

    async setPermissionMode(mode) {
      if (!isSandboxMode(mode)) throw new Error(`unknown codex sandbox mode "${mode}"`);
      threadOptions = { ...threadOptions, sandboxMode: mode };
      rebuildThread();
      emit({ type: "session.meta", data: { permissionMode: mode } });
    },

    async setModel(model) {
      const { model: _previous, ...rest } = threadOptions;
      threadOptions = model === codexDefaultModel.id ? rest : { ...rest, model };
      rebuildThread();
      emit({ type: "session.meta", data: { model } });
    },

    async dispose() {
      disposed = true;
      currentTurn?.abort();
      await turns;
    },
  };
}

/**
 * A resumed thread writes onto a log whose earlier turns are already numbered
 * from one, and this process never sees how far they got; a prefix unique to
 * the attach keeps its ids clear of theirs.
 */
function attachPrefix(): string {
  return `${Date.now().toString(36)}-`;
}

/**
 * Codex takes MCP servers as config, not as a session option: the SDK flattens
 * `config` into `--config mcp_servers.nib.url="…"` overrides on the `codex exec`
 * command line, and the CLI reads a `url` key as a streamable-HTTP server. The
 * instance is per session here, so the endpoint is the calling agent's own.
 */
export function codexOptions(executable: string, opts: CreateSessionOptions): CodexOptions {
  if (!opts.agentControl) return { codexPathOverride: executable };
  return {
    codexPathOverride: executable,
    config: {
      mcp_servers: {
        [agentControlServerName]: {
          url: opts.agentControl.url,
          tool_timeout_sec: agentToolTimeoutSeconds,
        },
      },
    },
  };
}

/**
 * The account's models, headed by the entry that leaves `--model` off. The
 * Codex SDK cannot enumerate models, but the CLI's `app-server` answers
 * `model/list` with the catalog its own picker shows. The CLI's on-disk cache
 * stands in when the app-server cannot answer; throws when neither can.
 */
async function discoverModels(config: CodexHarnessConfig): Promise<ModelInfo[]> {
  let models: ModelInfo[];
  try {
    const executable = resolveCodexExecutable(config.executable);
    models = parseModelList(await appServerRequest(executable, "model/list", {}));
  } catch {
    models = await readModelCache();
  }
  if (models.length === 0) throw new Error("codex listed no models");
  return [codexDefaultModel, ...models];
}

/**
 * The CLI caches the account's model list in `$CODEX_HOME/models_cache.json`.
 * Throws when the cache is absent or unreadable.
 */
async function readModelCache(): Promise<ModelInfo[]> {
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return parseModelCache(await readFile(join(codexHome, "models_cache.json"), "utf8"));
}

/** A runtime that cannot name its models simply leaves the composer on the adapter's static list. */
async function publishModels(
  listModels: () => Promise<ModelInfo[]>,
  emit: EmitEvent,
): Promise<void> {
  try {
    emit({ type: "session.meta", data: { models: await listModels() } });
  } catch (error) {
    emit({
      type: "log",
      data: { level: "debug", message: `codex model probe failed: ${describeError(error)}` },
    });
  }
}

function readSandboxMode(options: Record<string, unknown> | undefined): SandboxMode | null {
  const mode = options?.permissionMode;
  return typeof mode === "string" && isSandboxMode(mode) ? mode : null;
}

function readModelOption(options: Record<string, unknown> | undefined): { model?: string } {
  const model = options?.model;
  if (typeof model !== "string" || model === codexDefaultModel.id) return {};
  return { model };
}

function isSandboxMode(mode: string): mode is SandboxMode {
  return (sandboxModes as string[]).includes(mode);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
