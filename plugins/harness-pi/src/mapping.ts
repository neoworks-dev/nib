import type {
  BlockKind,
  EmittedEvent,
  HarnessCapabilities,
  MessageAttachment,
  ModelInfo,
  SlashCommandInfo,
} from "@nib-ui/protocol";

export const piHarnessId = "pi";

/**
 * pi states outright that it has no permission popups — tools are enabled or
 * disabled for the whole run and the model is never gated per call, so
 * `permission.requested` is never emitted and the permission slot carries a
 * single descriptive mode. Checkpoints are absent too: pi has no file snapshot
 * or rewind API.
 */
export const piCapabilities: HarnessCapabilities = {
  interrupt: true,
  permissionModes: [],
  resume: true,
  fork: true,
  slashCommands: true,
  models: true,
  effortLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
};

/** Selecting this leaves `--provider`/`--model` off, so pi keeps its own configured default. */
export const piDefaultModel: ModelInfo = {
  id: "default",
  displayName: "Default",
  description: "Provider and model configured in ~/.pi/agent",
};

/** Composer pre-flight only; the runtime's authenticated catalog replaces this at session start. */
export const piModels: ModelInfo[] = [piDefaultModel];

/**
 * pi addresses a model as provider plus id, but a `ModelInfo` carries one string.
 * `provider/id` is pi's own syntax for the pair, so the composed id round-trips
 * back through `ModelRuntime.getModel` without a separate encoding.
 */
export function composeModelId(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

export function splitModelId(id: string): { provider: string; modelId: string } | null {
  const separator = id.indexOf("/");
  if (separator <= 0 || separator === id.length - 1) return null;
  return { provider: id.slice(0, separator), modelId: id.slice(separator + 1) };
}

export interface PiStreamState {
  readonly cwd: string;
  /** Id this mount registered under; `session.created` has to name it, not the vocabulary. */
  readonly harnessId: string;
  readonly nativeSessionId: string | null;
  /** Id of the message currently open, assistant or user. */
  readonly messageId: string | null;
  readonly messages: number;
  readonly openBlocks: readonly string[];
  /**
   * Attachment metadata for the next user message. pi replays the prompt itself
   * — after expanding skills and templates — so its echo is what the transcript
   * records, and the metadata has to wait here for it.
   */
  readonly pendingAttachments: MessageAttachment[] | null;
  readonly totals: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly costUsd: number;
  };
}

export interface PiMapResult {
  state: PiStreamState;
  events: EmittedEvent[];
}

export function createPiStreamState(
  cwd: string,
  nativeSessionId: string | null = null,
  harnessId: string = piHarnessId,
): PiStreamState {
  return {
    cwd,
    harnessId,
    nativeSessionId,
    messageId: null,
    messages: 0,
    openBlocks: [],
    pendingAttachments: null,
    totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
  };
}

/** Parks attachment metadata until pi echoes the prompt it belongs to. */
export function queueUserAttachments(
  state: PiStreamState,
  attachments: MessageAttachment[] | undefined,
): PiStreamState {
  if (!attachments || attachments.length === 0) return state;
  return { ...state, pendingAttachments: attachments };
}

/**
 * Translates one `AgentSessionEvent` into normalized events. Every branch narrows
 * from `unknown`: pi's event union is open and grows with the agent's own
 * releases, so an unrecognized shape has to degrade into a log or an `ext`
 * passthrough instead of throwing and killing the subscription.
 */
export function mapPiEvent(state: PiStreamState, event: unknown): PiMapResult {
  if (!isRecord(event) || typeof event.type !== "string") {
    return { state, events: [unreadable("pi emitted an unreadable line", event)] };
  }

  switch (event.type) {
    case "agent_start":
      return { state, events: [{ type: "session.status", data: { status: "working" } }] };

    case "agent_settled":
      return { state, events: [{ type: "session.status", data: { status: "idle" } }] };

    // `turn_start`/`turn_end` bracket what `message_start`/`message_end` already
    // report, and `agent_end` repeats the run's messages verbatim.
    case "turn_start":
    case "turn_end":
    case "agent_end":
      return { state, events: [] };

    case "message_start":
      return startMessage(state, event);

    case "message_update":
      return mapDelta(state, event);

    case "message_end":
      return endMessage(state, event);

    case "tool_execution_end":
      return mapToolResult(state, event);

    // The tool call itself is already streamed as a `toolcall_*` block, and the
    // partial result is superseded by `tool_execution_end`.
    case "tool_execution_start":
    case "tool_execution_update":
      return { state, events: [] };

    // Persistence and queue bookkeeping; the message events already carry the content.
    case "entry_appended":
    case "queue_update":
      return { state, events: [] };

    case "thinking_level_changed":
      return {
        state,
        events: [{ type: "session.meta", data: { effort: readText(event.level) }, raw: event }],
      };

    case "session_info_changed":
      return {
        state,
        events: [{ type: "session.meta", data: { label: readText(event.name) }, raw: event }],
      };

    case "extension_error":
      return {
        state,
        events: [
          {
            type: "log",
            data: { level: "error", message: readErrorText(event) ?? "extension error" },
            raw: event,
          },
        ],
      };

    default:
      return {
        state,
        events: [
          { type: "ext", data: { ns: piHarnessId, type: event.type, data: event }, raw: event },
        ],
      };
  }
}

/** pi reports a model as provider plus id; the composer wants one addressable string. */
export function parseModels(data: unknown): ModelInfo[] {
  if (!isRecord(data) || !Array.isArray(data.models)) return [];
  const models: ModelInfo[] = [];
  for (const entry of data.models) {
    if (!isRecord(entry)) continue;
    const id = readModelId(entry);
    if (!id) continue;
    models.push({
      id,
      displayName: typeof entry.name === "string" ? entry.name : id,
      description: typeof entry.provider === "string" ? entry.provider : undefined,
    });
  }
  return models;
}

/** Extension commands, prompt templates and skills all reach the composer as `/name`. */
export function parseCommands(data: unknown): SlashCommandInfo[] {
  if (!isRecord(data) || !Array.isArray(data.commands)) return [];
  const commands: SlashCommandInfo[] = [];
  for (const entry of data.commands) {
    if (!isRecord(entry) || typeof entry.name !== "string") continue;
    commands.push({
      name: entry.name,
      description: typeof entry.description === "string" ? entry.description : undefined,
    });
  }
  return commands;
}

function readModelId(model: Record<string, unknown>): string | undefined {
  const { provider, id } = model;
  if (typeof provider !== "string" || typeof id !== "string") return undefined;
  return composeModelId(provider, id);
}

function startMessage(state: PiStreamState, event: Record<string, unknown>): PiMapResult {
  const message = event.message;
  const role = isRecord(message) ? message.role : undefined;
  if (role !== "user" && role !== "assistant") return { state, events: [] };

  const messageId = `msg-${state.messages + 1}`;
  const next: PiStreamState = {
    ...state,
    messages: state.messages + 1,
    messageId,
    openBlocks: [],
    pendingAttachments: role === "user" ? null : state.pendingAttachments,
  };
  const attachments = role === "user" ? (state.pendingAttachments ?? undefined) : undefined;
  const events: EmittedEvent[] = [
    { type: "message.started", data: { messageId, role, attachments }, raw: event },
  ];

  // pi delivers a user message whole rather than streaming it, so its one text
  // block is closed here instead of waiting for deltas that never come.
  if (role === "user" && isRecord(message)) {
    const blockId = `${messageId}:0`;
    events.push(
      { type: "block.started", data: { messageId, blockId, kind: "text" } },
      {
        type: "block.completed",
        data: { blockId, content: { kind: "text", text: readMessageText(message) } },
      },
      { type: "message.completed", data: { messageId } },
    );
    return { state: { ...next, messageId: null }, events };
  }
  return { state: next, events };
}

function endMessage(state: PiStreamState, event: Record<string, unknown>): PiMapResult {
  const message = event.message;
  // A user message was already completed when it started.
  if (!state.messageId || !isRecord(message) || message.role !== "assistant") {
    return { state, events: [] };
  }

  const stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
  const events: EmittedEvent[] = [
    { type: "message.completed", data: { messageId: state.messageId, stopReason }, raw: event },
  ];

  const totals = addUsage(state.totals, message.usage);
  if (totals !== state.totals) events.push({ type: "usage.updated", data: { ...totals } });

  // pi reports a failed turn on the message rather than as its own event.
  const errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : null;
  if (errorMessage) {
    events.push({ type: "session.status", data: { status: "error", detail: errorMessage } });
  }

  return { state: { ...state, messageId: null, openBlocks: [], totals }, events };
}

function mapDelta(state: PiStreamState, event: Record<string, unknown>): PiMapResult {
  const delta = event.assistantMessageEvent;
  if (!isRecord(delta) || typeof delta.type !== "string") return { state, events: [] };

  const ensured = ensureMessage(state);
  const messageId = ensured.messageId;
  const blockId = `${messageId}:${readNumber(delta.contentIndex)}`;
  const events = [...ensured.events];

  switch (delta.type) {
    case "text_start":
    case "thinking_start": {
      const kind: BlockKind = delta.type === "text_start" ? "text" : "thinking";
      const opened = openBlock(ensured.state, messageId, blockId, { kind }, event);
      return { state: opened.state, events: [...events, ...opened.events] };
    }

    case "text_delta":
    case "thinking_delta": {
      const kind: BlockKind = delta.type === "text_delta" ? "text" : "thinking";
      const opened = openBlock(ensured.state, messageId, blockId, { kind }, event);
      events.push(...opened.events, {
        type: "block.delta",
        data: { blockId, textDelta: readText(delta.delta) },
      });
      return { state: opened.state, events };
    }

    case "text_end":
    case "thinking_end": {
      const kind: BlockKind = delta.type === "text_end" ? "text" : "thinking";
      const opened = openBlock(ensured.state, messageId, blockId, { kind }, event);
      events.push(...opened.events, {
        type: "block.completed",
        data: { blockId, content: { kind, text: readText(delta.content) } },
        raw: event,
      });
      return { state: opened.state, events };
    }

    case "toolcall_start": {
      const opened = openBlock(
        ensured.state,
        messageId,
        blockId,
        { kind: "tool_use", toolName: readText(delta.toolName) },
        event,
      );
      return { state: opened.state, events: [...events, ...opened.events] };
    }

    case "toolcall_delta": {
      const opened = openBlock(ensured.state, messageId, blockId, { kind: "tool_use" }, event);
      events.push(...opened.events, {
        type: "block.delta",
        data: { blockId, inputJsonDelta: readText(delta.delta) },
      });
      return { state: opened.state, events };
    }

    case "toolcall_end": {
      const call = isRecord(delta.toolCall) ? delta.toolCall : null;
      const toolUseId = typeof call?.id === "string" ? call.id : blockId;
      const toolName = readText(call?.name);
      const opened = openBlock(
        ensured.state,
        messageId,
        blockId,
        { kind: "tool_use", toolName, toolUseId },
        event,
      );
      events.push(...opened.events, {
        type: "block.completed",
        data: {
          blockId,
          content: { kind: "tool_use", toolName, toolUseId, input: call?.arguments },
        },
        raw: event,
      });
      return { state: opened.state, events };
    }

    default:
      return { state: ensured.state, events };
  }
}

/**
 * The result arrives outside the assistant message that called the tool, so it
 * is attached to that message by `toolCallId` and given its own block.
 */
function mapToolResult(state: PiStreamState, event: Record<string, unknown>): PiMapResult {
  const toolUseId = typeof event.toolCallId === "string" ? event.toolCallId : null;
  if (!toolUseId) {
    return { state, events: [unreadable("pi ended a tool execution without an id", event)] };
  }

  const ensured = ensureMessage(state);
  const blockId = `${toolUseId}:result`;
  const toolName = readText(event.toolName);
  const opened = openBlock(
    ensured.state,
    ensured.messageId,
    blockId,
    { kind: "tool_result", toolName, toolUseId },
    event,
  );
  return {
    state: opened.state,
    events: [
      ...ensured.events,
      ...opened.events,
      {
        type: "block.completed",
        data: {
          blockId,
          content: {
            kind: "tool_result",
            toolUseId,
            output: readToolOutput(event.result),
            isError: event.isError === true,
          },
        },
        raw: event,
      },
    ],
  };
}

/** A tool result is a content-block array; renderers want the text it carries. */
function readToolOutput(result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.content)) return result;
  const text = result.content
    .filter((block): block is Record<string, unknown> => isRecord(block))
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
  if (text.length === 0) return result.content;
  return text.join("\n");
}

/** `content` is a string on a simple prompt and a block array once images are attached. */
function readMessageText(message: Record<string, unknown>): string {
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is Record<string, unknown> => isRecord(block))
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

interface BlockDescriptor {
  kind: BlockKind;
  toolName?: string;
  toolUseId?: string;
}

/** A delta can arrive before `message_start`; the message is synthesized rather than dropped. */
function ensureMessage(state: PiStreamState): {
  state: PiStreamState;
  events: EmittedEvent[];
  messageId: string;
} {
  if (state.messageId) return { state, events: [], messageId: state.messageId };
  const messageId = `msg-${state.messages + 1}`;
  return {
    state: { ...state, messages: state.messages + 1, messageId, openBlocks: [] },
    events: [{ type: "message.started", data: { messageId, role: "assistant" } }],
    messageId,
  };
}

/** Announces a block at most once; later deltas on the same index reuse the id. */
function openBlock(
  state: PiStreamState,
  messageId: string,
  blockId: string,
  descriptor: BlockDescriptor,
  raw: unknown,
): { state: PiStreamState; events: EmittedEvent[] } {
  if (state.openBlocks.includes(blockId)) return { state, events: [] };
  return {
    state: { ...state, openBlocks: [...state.openBlocks, blockId] },
    events: [{ type: "block.started", data: { messageId, blockId, ...descriptor }, raw }],
  };
}

function addUsage(totals: PiStreamState["totals"], usage: unknown): PiStreamState["totals"] {
  if (!isRecord(usage)) return totals;
  const cost = isRecord(usage.cost) ? readNumber(usage.cost.total) : 0;
  return {
    inputTokens: totals.inputTokens + readNumber(usage.input),
    outputTokens: totals.outputTokens + readNumber(usage.output),
    cacheReadTokens: totals.cacheReadTokens + readNumber(usage.cacheRead),
    costUsd: totals.costUsd + cost,
  };
}

function readErrorText(event: Record<string, unknown>): string | undefined {
  if (typeof event.error === "string") return event.error;
  if (typeof event.message === "string") return event.message;
  return undefined;
}

function unreadable(message: string, raw: unknown): EmittedEvent {
  return { type: "log", data: { level: "warn", message }, raw };
}

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  return "";
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
