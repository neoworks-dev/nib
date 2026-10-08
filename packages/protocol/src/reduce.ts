import {
  type AnyAgentEvent,
  type EventDataMap,
  isKnownEvent,
  type SessionUpdate,
  type ToolCallUpdate,
} from "./events";
import {
  type MessageItem,
  parentToolCallOf,
  type PermissionRequestView,
  type SessionView,
  type TerminalView,
  type ToolCallContent,
  type ToolItem,
  type ToolStatus,
  toolNameOf,
  type TranscriptItem,
} from "./session-view";

type UpdateOf<Kind extends SessionUpdate["sessionUpdate"]> = Extract<
  SessionUpdate,
  { sessionUpdate: Kind }
>;
type MessageChunk = UpdateOf<"agent_message_chunk"> | UpdateOf<"agent_thought_chunk">;
type ToolReport = UpdateOf<"tool_call"> | UpdateOf<"tool_call_update">;

/**
 * Pure projection of the append-only log. Events at or below `lastSeq` are
 * ignored so a reconnect that replays overlapping history is a no-op, and
 * anything this build cannot interpret lands in `unhandled` instead of throwing.
 */
export function reduceSession(state: SessionView, event: AnyAgentEvent): SessionView {
  if (event.seq <= state.lastSeq) return state;
  return { ...applyEvent(state, event), lastSeq: event.seq };
}

/** Folds a whole log into a session view, from the start. */
export function reduceSessionAll(state: SessionView, events: AnyAgentEvent[]): SessionView {
  return events.reduce(reduceSession, state);
}

/** Applies one event to the view, by what the event is. */
function applyEvent(state: SessionView, event: AnyAgentEvent): SessionView {
  if (!isKnownEvent(event)) return { ...state, unhandled: [...state.unhandled, event] };
  switch (event.type) {
    case "session.created":
      return applySessionCreated(state, event.data);
    case "session.meta":
      return applySessionMeta(state, event.data);
    case "session.cleared":
      return applySessionCleared(state, event.data);
    case "session.status":
      return applyStatus(state, event.data);
    case "user.message":
      return applyUserMessage(state, event.id, event.seq, event.data);
    case "update":
      return applyUpdate(state, event.id, event.seq, event.data.update);
    case "permission.requested":
      return applyPermissionRequested(state, event.data);
    case "permission.resolved":
      return applyPermissionResolved(state, event.data);
    case "usage":
      return applyUsage(state, event.data);
    case "turn.done":
      return applyTurnDone(state, event.data);
    case "log":
      return { ...state, logs: [...state.logs, { ...event.data, ts: event.ts }] };
    case "ext":
      return { ...state, unhandled: [...state.unhandled, event] };
  }
}

/** The session exists, in this harness and directory, under this native id. */
function applySessionCreated(
  state: SessionView,
  data: EventDataMap["session.created"],
): SessionView {
  return {
    ...state,
    harnessId: data.harnessId,
    cwd: data.cwd,
    title: data.title ?? state.title,
    nativeSessionId: data.nativeSessionId ?? state.nativeSessionId,
    parentSessionId: data.parentSessionId ?? state.parentSessionId,
    capabilities: data.capabilities,
  };
}

/** Every field is optional: a partial update must not clear what it omits. */
function applySessionMeta(state: SessionView, data: EventDataMap["session.meta"]): SessionView {
  return {
    ...state,
    title: data.label ?? state.title,
    model: data.model ?? state.model,
    permissionMode: data.permissionMode ?? state.permissionMode,
    effort: data.effort ?? state.effort,
    archived: data.archived ?? state.archived,
    slashCommands: data.slashCommands ?? state.slashCommands,
    models: data.models ?? state.models,
  };
}

/** Usage and metadata survive: only the conversation went away. */
function applySessionCleared(
  state: SessionView,
  data: EventDataMap["session.cleared"],
): SessionView {
  return {
    ...state,
    nativeSessionId: data.nativeSessionId ?? state.nativeSessionId,
    items: [],
    plan: [],
    stopReason: null,
    pendingPermissions: [],
    resolvedPermissions: [],
  };
}

/** The status, and the end of whatever the agent was saying once it stops working. */
function applyStatus(state: SessionView, data: EventDataMap["session.status"]): SessionView {
  const next = { ...state, status: data.status, statusDetail: data.detail ?? null };
  if (data.status === "working") return { ...next, stopReason: null };
  if (data.status === "awaiting-permission") return next;
  return { ...next, items: closeStreaming(state.items) };
}

/** A prompt ends whatever the agent was saying and starts a turn. */
function applyUserMessage(
  state: SessionView,
  eventId: string,
  seq: number,
  data: EventDataMap["user.message"],
): SessionView {
  const item: TranscriptItem = {
    type: "user",
    id: eventId,
    seq,
    text: data.text,
    attachments: data.attachments ?? [],
  };
  return { ...state, items: [...closeStreaming(state.items), item], stopReason: null };
}

/** A turn ended: nothing is streaming any more, and the harness says why. */
function applyTurnDone(state: SessionView, data: EventDataMap["turn.done"]): SessionView {
  return { ...state, items: closeStreaming(state.items), stopReason: data.stopReason };
}

/** Folds one ACP session update into the transcript, the plan or the session's own fields. */
function applyUpdate(
  state: SessionView,
  eventId: string,
  seq: number,
  update: SessionUpdate,
): SessionView {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return applyChunk(state, eventId, seq, "text", update);
    case "agent_thought_chunk":
      return applyChunk(state, eventId, seq, "thought", update);
    case "tool_call":
    case "tool_call_update":
      return applyToolReport(state, eventId, seq, update);
    case "plan":
      return { ...state, plan: update.entries };
    case "available_commands_update":
      return { ...state, slashCommands: slashCommandsOf(update) };
    case "session_info_update":
      return applySessionInfo(state, update);
    default:
      return state;
  }
}

/** The commands the harness offers, in the shape the composer lists them. */
function slashCommandsOf(update: UpdateOf<"available_commands_update">) {
  return update.availableCommands.map((command) => {
    const hint = (command.input as { hint?: unknown } | null | undefined)?.hint;
    return {
      name: command.name,
      description: command.description,
      argumentHint: typeof hint === "string" ? hint : undefined,
    };
  });
}

/** The harness titled the conversation. */
function applySessionInfo(state: SessionView, update: UpdateOf<"session_info_update">): SessionView {
  if (typeof update.title !== "string" || update.title.trim().length === 0) return state;
  return { ...state, title: update.title };
}

// ── Messages ─────────────────────────────────────────────────────

/**
 * Adds a chunk to the message it continues, or opens a new one. A message runs
 * from its first chunk until something else happens or the harness starts one
 * under another message id; a chunk with no id continues the open one.
 */
function applyChunk(
  state: SessionView,
  eventId: string,
  seq: number,
  type: MessageItem["type"],
  chunk: MessageChunk,
): SessionView {
  if (chunk.content.type !== "text") return state;
  const text = chunk.content.text;
  const messageId = chunk.messageId ?? null;
  const parentToolCallId = parentToolCallOf(chunk);

  const openIndex = continuedMessageIndex(state.items, type, messageId, parentToolCallId);
  if (openIndex >= 0) {
    const open = state.items[openIndex] as MessageItem;
    const items = [...state.items];
    items[openIndex] = { ...open, text: open.text + text, messageId: open.messageId ?? messageId };
    return { ...state, items };
  }

  const item: MessageItem = {
    type,
    id: eventId,
    seq,
    messageId,
    text,
    streaming: true,
    parentToolCallId,
  };
  return { ...state, items: [...state.items, item] };
}

/** The index of the message a chunk continues, or -1 when it opens a new one. */
function continuedMessageIndex(
  items: TranscriptItem[],
  type: MessageItem["type"],
  messageId: string | null,
  parentToolCallId: string | null,
): number {
  const index = lastIndexWithParent(items, parentToolCallId);
  if (index < 0) return -1;
  const last = items[index]!;
  if (last.type !== type || !last.streaming) return -1;
  const another = messageId !== null && last.messageId !== null && last.messageId !== messageId;
  if (another) return -1;
  return index;
}

/** The index of the newest item that belongs to this subagent (or to the session itself). */
function lastIndexWithParent(items: TranscriptItem[], parentToolCallId: string | null): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.type === "user") {
      if (parentToolCallId === null) return index;
      continue;
    }
    if (item.parentToolCallId === parentToolCallId) return index;
  }
  return -1;
}

/** Ends every message that was still being written. */
function closeStreaming(items: TranscriptItem[]): TranscriptItem[] {
  if (!items.some(isStreaming)) return items;
  return items.map((item) => {
    if (!isStreaming(item)) return item;
    return { ...item, streaming: false };
  });
}

function isStreaming(item: TranscriptItem): item is MessageItem {
  return (item.type === "text" || item.type === "thought") && item.streaming;
}

// ── Tool calls ───────────────────────────────────────────────────

/**
 * Folds a report on a tool call into its item, creating the item on first
 * sight. A call is refined as its input streams in, so every field the report
 * carries replaces what the item had and a field it leaves out is kept.
 */
function applyToolReport(
  state: SessionView,
  eventId: string,
  seq: number,
  report: ToolReport,
): SessionView {
  const index = state.items.findIndex(
    (item) => item.type === "tool" && item.toolCallId === report.toolCallId,
  );
  if (index >= 0) {
    const items = [...state.items];
    items[index] = mergeToolReport(items[index] as ToolItem, report);
    return { ...state, items };
  }
  const fresh = mergeToolReport(newToolItem(report.toolCallId, seq), report);
  const closing = closeStreamingFor(state.items, fresh.parentToolCallId);
  return { ...state, items: [...closing, fresh] };
}

/** Ends the open message of one subagent (or of the session itself) when a tool call begins. */
function closeStreamingFor(
  items: TranscriptItem[],
  parentToolCallId: string | null,
): TranscriptItem[] {
  const index = lastIndexWithParent(items, parentToolCallId);
  if (index < 0 || !isStreaming(items[index]!)) return items;
  const closed = [...items];
  closed[index] = { ...(items[index] as MessageItem), streaming: false };
  return closed;
}

/** A tool call as it stands before the harness has said anything about it. */
function newToolItem(toolCallId: string, seq: number): ToolItem {
  return {
    type: "tool",
    id: toolCallId,
    toolCallId,
    seq,
    name: "",
    title: "",
    kind: "other",
    status: "pending",
    rawInput: undefined,
    rawOutput: undefined,
    content: [],
    locations: [],
    terminal: null,
    parentToolCallId: null,
  };
}

/** The call with one report's fields laid over it. */
function mergeToolReport(tool: ToolItem, report: ToolReport): ToolItem {
  const merged: ToolItem = { ...tool };
  const name = toolNameOf(report);
  if (name.length > 0) merged.name = name;
  if (report.title) merged.title = report.title;
  if (report.kind) merged.kind = report.kind;
  if (report.status) merged.status = report.status satisfies ToolStatus;
  if (report.rawInput !== undefined) merged.rawInput = report.rawInput;
  if (report.rawOutput !== undefined) merged.rawOutput = report.rawOutput;
  if (report.content) merged.content = mergeContent(tool.content, report.content);
  if (report.locations) merged.locations = report.locations;
  const parent = parentToolCallOf(report);
  if (parent !== null) merged.parentToolCallId = parent;
  merged.terminal = terminalAfter(merged.terminal, report);
  return merged;
}

/**
 * A report's content replaces the call's, except for file changes and terminals the
 * report does not repeat: pi shows the diff with the first report and the result
 * text with the last, and the call should keep both.
 */
function mergeContent(prior: ToolCallContent[], next: ToolCallContent[]): ToolCallContent[] {
  const kept = prior.filter((entry) => {
    if (entry.type !== "diff" && entry.type !== "terminal") return false;
    return !next.some((candidate) => sameTarget(entry, candidate));
  });
  return [...kept, ...next];
}

/** Whether two content entries are about the same file or terminal. */
function sameTarget(left: ToolCallContent, right: ToolCallContent): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "diff") return left.path === (right as typeof left).path;
  return left.type === "terminal";
}

/** What a shell command has printed, once this report's terminal metadata is folded in. */
function terminalAfter(current: TerminalView | null, report: ToolCallUpdate): TerminalView | null {
  const meta = report._meta ?? undefined;
  let terminal = current;
  if (terminal === null && hasTerminal(report.content, meta)) {
    terminal = { output: "", exitCode: null, signal: null, finished: false };
  }
  if (terminal === null || meta === undefined) return terminal;

  const full = meta.terminal_output as { data?: unknown } | undefined;
  if (typeof full?.data === "string") terminal = { ...terminal, output: full.data };
  const delta = meta.terminal_output_delta as { data?: unknown } | undefined;
  if (typeof delta?.data === "string") {
    terminal = { ...terminal, output: terminal.output + delta.data };
  }
  const exit = meta.terminal_exit as { exit_code?: unknown; signal?: unknown } | undefined;
  if (exit !== undefined) {
    terminal = {
      ...terminal,
      finished: true,
      exitCode: typeof exit.exit_code === "number" ? exit.exit_code : null,
      signal: typeof exit.signal === "string" ? exit.signal : null,
    };
  }
  return terminal;
}

/** Whether a report says its call runs in a terminal. */
function hasTerminal(
  content: ToolCallContent[] | null | undefined,
  meta: { [key: string]: unknown } | undefined,
): boolean {
  if (meta !== undefined) {
    const marked = [meta.terminal_info, meta.terminal_output, meta.terminal_output_delta];
    if (marked.some((entry) => entry !== undefined)) return true;
  }
  if (!content) return false;
  return content.some((entry) => entry.type === "terminal");
}

// ── Permissions ──────────────────────────────────────────────────

/** A tool call is held for a decision. */
function applyPermissionRequested(
  state: SessionView,
  data: EventDataMap["permission.requested"],
): SessionView {
  if (state.pendingPermissions.some((request) => request.requestId === data.requestId)) {
    return state;
  }
  const call = data.request.toolCall;
  const request: PermissionRequestView = {
    requestId: data.requestId,
    toolCallId: call.toolCallId,
    toolName: toolNameOf(call),
    input: call.rawInput,
    request: data.request,
  };
  return { ...state, pendingPermissions: [...state.pendingPermissions, request] };
}

/** The decision is in, so the request is no longer pending. */
function applyPermissionResolved(
  state: SessionView,
  data: EventDataMap["permission.resolved"],
): SessionView {
  return {
    ...state,
    pendingPermissions: state.pendingPermissions.filter(
      (request) => request.requestId !== data.requestId,
    ),
    resolvedPermissions: [
      ...state.resolvedPermissions,
      { requestId: data.requestId, behavior: data.behavior, resolvedBy: data.resolvedBy },
    ],
  };
}

// ── Usage ────────────────────────────────────────────────────────

/** The session's running totals replace the old ones, as the harness reports them whole. */
function applyUsage(state: SessionView, data: EventDataMap["usage"]): SessionView {
  const { total } = data;
  return {
    ...state,
    usage: {
      inputTokens: total.input ?? 0,
      outputTokens: total.output ?? 0,
      cacheReadTokens: total.cacheRead ?? 0,
      cacheWriteTokens: total.cacheWrite ?? 0,
      costUsd: total.costUsd ?? 0,
      context: data.context ?? state.usage.context,
    },
  };
}
