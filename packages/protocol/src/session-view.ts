import type { HarnessCapabilities } from "./capabilities";
import type {
  AnyAgentEvent,
  BlockContent,
  BlockKind,
  MessageAttachment,
  MessageRole,
  ModelInfo,
  PermissionBehavior,
  SessionStatus,
  SlashCommandInfo,
} from "./events";

export interface BlockView {
  id: string;
  messageId: string;
  kind: BlockKind;
  toolName: string | null;
  toolUseId: string | null;
  /** Accumulated `textDelta`s; superseded by `content` once the block completes. */
  text: string;
  /** Accumulated `inputJsonDelta`s for tool_use blocks — may be incomplete JSON while streaming. */
  inputJson: string;
  content: BlockContent | null;
  completed: boolean;
}

export interface MessageView {
  id: string;
  role: MessageRole;
  blocks: BlockView[];
  completed: boolean;
  stopReason: string | null;
  /**
   * Files sent with the prompt; the reducer always fills it, empty for anything
   * the harness produced. Optional so a consumer that builds a message by hand
   * does not have to name it.
   */
  attachments?: MessageAttachment[];
}

export interface UsageView {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface PermissionRequestView {
  requestId: string;
  toolName: string;
  input: unknown;
  suggestions: unknown[];
}

export interface LogEntryView {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  ts: number;
}

export interface PermissionResolutionView {
  requestId: string;
  behavior: PermissionBehavior;
  resolvedBy: "user" | "policy";
}

export interface SessionView {
  sessionId: string;
  harnessId: string | null;
  cwd: string | null;
  title: string | null;
  nativeSessionId: string | null;
  /** The session whose agent spawned this one; null for a session the user started. */
  parentSessionId: string | null;
  capabilities: HarnessCapabilities | null;
  /** Active permission mode, as last reported by the harness. */
  permissionMode: string | null;
  /** Active reasoning-effort level, when the harness has any. */
  effort: string | null;
  /** Archived tasks stay listable and resumable; the sidebar just stops showing them. */
  archived: boolean;
  model: string | null;
  slashCommands: SlashCommandInfo[];
  models: ModelInfo[];
  status: SessionStatus;
  statusDetail: string | null;
  messages: MessageView[];
  usage: UsageView;
  pendingPermissions: PermissionRequestView[];
  resolvedPermissions: PermissionResolutionView[];
  logs: LogEntryView[];
  /** `ext` events and event types this build does not know — preserved, never fatal. */
  unhandled: AnyAgentEvent[];
  /** Deltas that arrived before their `block.started`; merged in when the block appears. */
  orphanBlocks: Record<string, OrphanBlock>;
  /** Message id → the harness's restore point for the working tree as it was before it. */
  checkpoints: Record<string, string>;
  lastSeq: number;
}

export interface OrphanBlock {
  text: string;
  inputJson: string;
  content: BlockContent | null;
  completed: boolean;
}

/** One turn of the tail, as a card draws it: who said it and what they said. */
export interface DigestMessage {
  role: MessageRole;
  text: string;
}

/**
 * How much of the end of a chat a digest carries. Bounded on purpose: every
 * session's digest is on screen at once on a board of cards, so the tail is as
 * much as a card can draw and not a transcript in miniature.
 */
const RECENT_LIMIT = 8;
const RECENT_CHARS = 320;

/**
 * What a chat was asked, where it has got to, and the end of what was said in
 * between. For anything that stands for the whole of one without opening it — a
 * card on the board, a row in a list — and nothing more: a digest is a glance,
 * so it carries no tool calls, no usage and no full history.
 */
export interface SessionDigest {
  /** The opening prompt, which is what the chat is about. */
  prompt: string | null;
  /** The newest thing the harness said, which is where it has got to. */
  reply: string | null;
  /**
   * The last few turns with prose in them, oldest first, each clipped. The
   * opening prompt is left out: it is the chat's name rather than part of its
   * recent history, and a card that drew both would say it twice.
   */
  recent: DigestMessage[];
}

export function sessionDigest(session: SessionView): SessionDigest {
  let prompt: string | null = null;
  let reply: string | null = null;
  const spoken: DigestMessage[] = [];

  for (const message of session.messages) {
    const text = messageText(message);
    if (text.length === 0) continue;
    // A user message carrying only tool results is bookkeeping inside a turn, so
    // the opening prompt is the first one with prose in it.
    if (message.role === "user" && prompt === null) {
      prompt = text;
      continue;
    }
    if (message.role === "assistant") reply = text;
    spoken.push({ role: message.role, text: clipText(text, RECENT_CHARS) });
  }

  return { prompt, reply, recent: spoken.slice(-RECENT_LIMIT) };
}

function clipText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}…`;
}

/** Everything the message said, with its tool calls and results left out. */
export function messageText(message: MessageView): string {
  return message.blocks
    .filter((block) => block.kind === "text")
    .map((block) => (block.content?.kind === "text" ? block.content.text : block.text))
    .join("\n")
    .trim();
}

/** Completed input when the block finished, otherwise the partial JSON parsed best-effort. */
export function blockToolInput<T = unknown>(block: BlockView): T | undefined {
  if (block.content?.kind === "tool_use") return (block.content as { input?: T }).input;
  if (block.inputJson.length === 0) return undefined;
  try {
    return JSON.parse(block.inputJson) as T;
  } catch {
    return block.inputJson as T;
  }
}

export function blockToolOutput<T = unknown>(block: BlockView | null): T | undefined {
  if (!block) return undefined;
  if (block.content?.kind === "tool_result") return (block.content as { output?: T }).output;
  if (block.text.length === 0) return undefined;
  return block.text as T;
}

/** The result block a tool call produced, once the harness reports it. */
export function findToolResultBlock(
  session: SessionView,
  toolUseId: string | null,
): BlockView | null {
  return findBlockByToolUseId(session, "tool_result", toolUseId);
}

/** Lets a result renderer detect that its call is already on screen and stay quiet. */
export function findToolUseBlock(session: SessionView, toolUseId: string | null): BlockView | null {
  return findBlockByToolUseId(session, "tool_use", toolUseId);
}

function findBlockByToolUseId(
  session: SessionView,
  kind: BlockKind,
  toolUseId: string | null,
): BlockView | null {
  if (!toolUseId) return null;
  for (const message of session.messages) {
    for (const block of message.blocks) {
      if (block.kind === kind && block.toolUseId === toolUseId) return block;
    }
  }
  return null;
}

/**
 * A pending permission describes a tool call that has not entered the message
 * log yet; shaping it as a block lets the same renderers preview it.
 */
export function permissionPreviewBlock(request: PermissionRequestView): BlockView {
  return {
    id: `permission:${request.requestId}`,
    messageId: `permission:${request.requestId}`,
    kind: "tool_use",
    toolName: request.toolName,
    toolUseId: null,
    text: "",
    inputJson: "",
    content: { kind: "tool_use", toolName: request.toolName, toolUseId: "", input: request.input },
    completed: true,
  };
}

export function createSessionView(sessionId: string): SessionView {
  return {
    sessionId,
    harnessId: null,
    cwd: null,
    title: null,
    nativeSessionId: null,
    parentSessionId: null,
    capabilities: null,
    permissionMode: null,
    effort: null,
    archived: false,
    model: null,
    slashCommands: [],
    models: [],
    status: "idle",
    statusDetail: null,
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
    pendingPermissions: [],
    resolvedPermissions: [],
    logs: [],
    unhandled: [],
    orphanBlocks: {},
    checkpoints: {},
    lastSeq: 0,
  };
}

/**
 * The restore point that undoes a turn. An assistant message's edits belong to
 * the user message that asked for them, so the search walks back from the given
 * message to the nearest checkpointed one.
 */
export function checkpointBefore(session: SessionView, messageId: string): string | null {
  const index = session.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return null;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const checkpoint = session.checkpoints[session.messages[cursor]!.id];
    if (checkpoint) return checkpoint;
  }
  return null;
}
