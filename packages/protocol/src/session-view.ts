import type { HarnessCapabilities } from "./capabilities";
import type {
  AnyAgentEvent,
  MessageAttachment,
  ModelInfo,
  PermissionBehavior,
  RequestPermissionRequest,
  SessionStatus,
  SessionUpdate,
  SlashCommandInfo,
  ToolCallUpdate,
} from "./events";

/** One piece of what a tool call carries: text or an image, a file diff, a terminal. */
export type ToolCallContent = NonNullable<ToolCallUpdate["content"]>[number];

/** A place in the code a tool call touches. */
export type ToolCallLocation = NonNullable<ToolCallUpdate["locations"]>[number];

/** ACP's kind of tool call (`read`, `edit`, `execute`, …), open because a harness may invent one. */
export type ToolKind = string;

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

/** One entry of the agent's plan, as ACP reports it. */
export type PlanEntry = Extract<SessionUpdate, { sessionUpdate: "plan" }>["entries"][number];

/** A file change a tool call carries, as an ACP `diff`. */
export interface ToolDiff {
  path: string;
  /** Null when the call creates the file. */
  oldText: string | null;
  newText: string;
}

/** What a shell command printed, built from the terminal reports on its tool call. */
export interface TerminalView {
  output: string;
  exitCode: number | null;
  signal: string | null;
  /** The command has exited. */
  finished: boolean;
}

/** The user's prompt, as sent. */
export interface UserItem {
  type: "user";
  /** The id of the event that logged the prompt. */
  id: string;
  seq: number;
  text: string;
  attachments: MessageAttachment[];
}

/**
 * What the agent said (`text`) or thought (`thought`), gathered from its chunks.
 * A message runs from its first chunk until something else happens, or the
 * harness starts one under another message id.
 */
export interface MessageItem {
  type: "text" | "thought";
  /** The id of the event that carried the first chunk. */
  id: string;
  seq: number;
  /** The harness's id for the message; null when it gives none (pi). */
  messageId: string | null;
  text: string;
  /** More chunks may still arrive. */
  streaming: boolean;
  /** The tool call whose subagent said it; null for the session's own agent. */
  parentToolCallId: string | null;
}

/** A tool call as its updates left it. */
export interface ToolItem {
  type: "tool";
  /** The tool call id. */
  id: string;
  toolCallId: string;
  seq: number;
  /** The tool's own name (`Bash`, `bash`, `mcp__nib__spawn_agent`); empty when the harness gave none. */
  name: string;
  /** How the harness describes this call: `Read notes.txt`, `echo hello`. */
  title: string;
  kind: ToolKind;
  status: ToolStatus;
  rawInput: unknown;
  rawOutput: unknown;
  content: ToolCallContent[];
  locations: ToolCallLocation[];
  /** Set for shell commands. */
  terminal: TerminalView | null;
  /** The tool call whose subagent made this one; null for the session's own agent. */
  parentToolCallId: string | null;
}

export type TranscriptItem = UserItem | MessageItem | ToolItem;

/**
 * An agent's turn: everything between one prompt and the next. A turn is as
 * long as the agent keeps working, so it is the unit a card or footer can
 * summarise.
 */
export interface AgentTurn {
  type: "agent";
  /** The id of the first item in the turn. */
  id: string;
  items: Array<MessageItem | ToolItem>;
  /** The turn has ended: a prompt or a `turn.done` came after it. */
  completed: boolean;
  /** Why it ended, when it did. */
  stopReason: string | null;
}

/** A prompt the user sent. */
export interface UserTurn {
  type: "user";
  id: string;
  item: UserItem;
}

export type TranscriptTurn = UserTurn | AgentTurn;

export interface UsageView {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** How full the model's context window is; null until the harness says. */
  context: { used: number; size: number } | null;
}

export interface PermissionRequestView {
  requestId: string;
  /** The tool call the request is about. */
  toolCallId: string;
  toolName: string;
  /** What the tool would run with. */
  input: unknown;
  /** The request as the harness made it, whole. */
  request: RequestPermissionRequest;
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
  /** The conversation, in the order it happened. */
  items: TranscriptItem[];
  /** The agent's plan, as last reported. */
  plan: PlanEntry[];
  /** Why the latest turn ended; null while one is running or before the first. */
  stopReason: string | null;
  usage: UsageView;
  pendingPermissions: PermissionRequestView[];
  resolvedPermissions: PermissionResolutionView[];
  logs: LogEntryView[];
  /** `ext` events and event types this build does not know — preserved, never fatal. */
  unhandled: AnyAgentEvent[];
  lastSeq: number;
}

/** One turn of the tail, as a card draws it: who said it and what they said. */
export interface DigestMessage {
  role: "user" | "assistant";
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

/** Folds a session down to the glance a card or list row draws. */
export function sessionDigest(session: SessionView): SessionDigest {
  let prompt: string | null = null;
  let reply: string | null = null;
  const spoken: DigestMessage[] = [];

  for (const item of session.items) {
    const spokenItem = spokenText(item);
    if (spokenItem === null) continue;
    if (item.type === "user" && prompt === null) {
      prompt = spokenItem.text;
      continue;
    }
    if (spokenItem.role === "assistant") reply = spokenItem.text;
    spoken.push({ role: spokenItem.role, text: clipText(spokenItem.text, RECENT_CHARS) });
  }

  return { prompt, reply, recent: spoken.slice(-RECENT_LIMIT) };
}

/** What an item says to the person reading the chat, or null for one that says nothing. */
function spokenText(item: TranscriptItem): DigestMessage | null {
  if (item.type === "user") return textOrNull("user", item.text);
  if (item.type === "text" && item.parentToolCallId === null) {
    return textOrNull("assistant", item.text);
  }
  return null;
}

function textOrNull(role: DigestMessage["role"], text: string): DigestMessage | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return { role, text: trimmed };
}

function clipText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}…`;
}

/**
 * Splits the conversation into the user's prompts and the agent's turns between
 * them. The turn after the last prompt is the one in flight while the session is
 * working. Subagent items belong to their parent call and are not turn items.
 */
export function transcriptTurns(session: SessionView): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let current: AgentTurn | null = null;
  for (const item of session.items) {
    if (item.type === "user") {
      if (current) current.completed = true;
      current = null;
      turns.push({ type: "user", id: item.id, item });
      continue;
    }
    if (item.parentToolCallId !== null) continue;
    if (current === null) {
      current = { type: "agent", id: item.id, items: [], completed: false, stopReason: null };
      turns.push(current);
    }
    current.items.push(item);
  }
  if (current && session.status !== "working" && session.status !== "awaiting-permission") {
    current.completed = true;
    current.stopReason = session.stopReason;
  }
  return turns;
}

/** The subagent items a tool call produced, in order. */
export function subagentItems(
  session: SessionView,
  toolCallId: string,
): Array<MessageItem | ToolItem> {
  const found: Array<MessageItem | ToolItem> = [];
  for (const item of session.items) {
    if (item.type === "user") continue;
    if (item.parentToolCallId === toolCallId) found.push(item);
  }
  return found;
}

/** Whether a call has finished, one way or the other. */
export function isToolSettled(tool: Pick<ToolItem, "status">): boolean {
  return tool.status === "completed" || tool.status === "failed";
}

/** The tool call with this id, once the harness has reported it. */
export function findToolItem(session: SessionView, toolCallId: string | null): ToolItem | null {
  if (!toolCallId) return null;
  for (const item of session.items) {
    if (item.type === "tool" && item.toolCallId === toolCallId) return item;
  }
  return null;
}

/** The call's input as an object, or undefined while the harness has sent none. */
export function toolInput(tool: Pick<ToolItem, "rawInput">): Record<string, unknown> | undefined {
  const input = tool.rawInput;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  return input as Record<string, unknown>;
}

/** One string field of a call's input, or undefined when the call has no such field. */
export function toolInputString(
  tool: Pick<ToolItem, "rawInput">,
  ...keys: string[]
): string | undefined {
  const input = toolInput(tool);
  if (!input) return undefined;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/** The file changes a call carries, as ACP diffs. */
export function toolDiffs(tool: Pick<ToolItem, "content">): ToolDiff[] {
  const diffs: ToolDiff[] = [];
  for (const entry of tool.content) {
    if (entry.type !== "diff") continue;
    const diff = entry as { path: string; oldText?: string | null; newText: string };
    let oldText: string | null = null;
    if (typeof diff.oldText === "string") oldText = diff.oldText;
    diffs.push({ path: diff.path, oldText, newText: diff.newText });
  }
  return diffs;
}

/**
 * The text of a call's result: its text content, else what it reported raw (a
 * string, or the text blocks of a structured output), else what a shell command
 * printed.
 */
export function toolOutputText(tool: Pick<ToolItem, "content" | "rawOutput" | "terminal">): string {
  const fromContent = tool.content
    .map(contentEntryText)
    .filter((part) => part.length > 0)
    .join("\n");
  if (fromContent.length > 0) return fromContent;
  const fromRaw = rawOutputText(tool.rawOutput);
  if (fromRaw.length > 0) return fromRaw;
  if (tool.terminal) return tool.terminal.output;
  return "";
}

/** The text of a ACP content entry, empty for anything that is not text. */
function contentEntryText(entry: ToolCallContent): string {
  if (entry.type !== "content") return "";
  const block = (entry as { content: { type: string; text?: string } }).content;
  if (block.type !== "text" || typeof block.text !== "string") return "";
  return block.text;
}

/** The text of what a call reported raw: a string as it is, text blocks joined, empty otherwise. */
export function rawOutputText(rawOutput: unknown): string {
  if (typeof rawOutput === "string") return rawOutput;
  if (Array.isArray(rawOutput)) return textBlocks(rawOutput);
  if (typeof rawOutput !== "object" || rawOutput === null) return "";
  const nested = (rawOutput as { content?: unknown }).content;
  if (Array.isArray(nested)) return textBlocks(nested);
  return "";
}

function textBlocks(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string" && text.length > 0) parts.push(text);
  }
  return parts.join("\n");
}

/** The text of one ACP content block, empty for anything that is not text. */
export function contentBlockText(block: { type: string; text?: unknown }): string {
  if (block.type !== "text" || typeof block.text !== "string") return "";
  return block.text;
}

/**
 * The tool's own name: ACP's `name`, or the one Claude's adapter keeps in its
 * metadata. A harness that reports neither leaves it empty.
 */
export function toolNameOf(update: {
  name?: string | null;
  _meta?: { [key: string]: unknown } | null;
}): string {
  if (update.name) return update.name;
  const claudeCode = update._meta?.claudeCode as { toolName?: unknown } | undefined;
  if (typeof claudeCode?.toolName === "string") return claudeCode.toolName;
  return "";
}

/** The tool call a subagent update ran inside, from the metadata the harness attaches. */
export function parentToolCallOf(update: {
  _meta?: { [key: string]: unknown } | null;
}): string | null {
  const neoworks = update._meta?.neoworks as { parentToolCallId?: unknown } | undefined;
  if (typeof neoworks?.parentToolCallId === "string") return neoworks.parentToolCallId;
  const claudeCode = update._meta?.claudeCode as { parentToolUseId?: unknown } | undefined;
  if (typeof claudeCode?.parentToolUseId === "string") return claudeCode.parentToolUseId;
  return null;
}

/**
 * A pending permission describes a tool call the transcript may not hold yet;
 * shaping it as one lets the same renderers preview it. The live call wins when
 * the harness has reported it already, since it carries more.
 */
export function permissionPreviewTool(
  session: SessionView,
  request: PermissionRequestView,
): ToolItem {
  const live = findToolItem(session, request.toolCallId);
  if (live) return live;
  const call = request.request.toolCall;
  return {
    type: "tool",
    id: `permission:${request.requestId}`,
    toolCallId: request.toolCallId,
    seq: 0,
    name: request.toolName,
    title: call.title ?? "",
    kind: call.kind ?? "other",
    status: "pending",
    rawInput: request.input,
    rawOutput: undefined,
    content: call.content ?? [],
    locations: call.locations ?? [],
    terminal: null,
    parentToolCallId: null,
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
    items: [],
    plan: [],
    stopReason: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      context: null,
    },
    pendingPermissions: [],
    resolvedPermissions: [],
    logs: [],
    unhandled: [],
    lastSeq: 0,
  };
}
