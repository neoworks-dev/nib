// Logs written before nib stored ACP.
//
// Those logs describe a conversation as messages made of blocks (`message.started`,
// `block.started`, `block.delta`, `block.completed`). They stay on disk as they
// are; this converts each line to the events that replace them as the log is read,
// in memory only.
//
// The conversion is one event in, at most one event out, with the sequence number
// kept. A log that mixes old lines with new ones (a session resumed after the
// switch) therefore keeps one numbering, and the next event appended after a
// restore still lands above the last one on disk.

import type { SessionUpdate } from "./events";

type RawEvent = Record<string, unknown> & { type: string; data: Record<string, unknown> };

/** What the converter remembers about a block it has seen start. */
interface SeenBlock {
  kind: string;
  messageId: string;
  /** Text arrived as deltas, so the completed block must not repeat it. */
  streamed: boolean;
  toolUseId: string | null;
}

/** What the converter remembers about a message it has seen start. */
interface SeenMessage {
  role: string;
  attachments: unknown;
}

/** The event types only the old format has. */
const legacyTypes = new Set([
  "message.started",
  "message.completed",
  "message.checkpoint",
  "block.started",
  "block.delta",
  "block.completed",
  "usage.updated",
]);

/** Converts the lines of one log, in order. Returns null for a line that has no equivalent. */
export type LegacyUpgrader = (input: unknown) => unknown;

/** Makes the converter for one log; it follows blocks across lines, so it is not shared between logs. */
export function createLegacyUpgrader(): LegacyUpgrader {
  const messages = new Map<string, SeenMessage>();
  const blocks = new Map<string, SeenBlock>();

  /** Converts one old line, or passes a line that is already in the new format through. */
  return (input) => {
    if (!isRawEvent(input)) return input;
    if (isLegacyPermissionRequest(input)) return upgradePermissionRequest(input);
    if (!legacyTypes.has(input.type)) return input;
    switch (input.type) {
      case "message.started":
        messages.set(String(input.data.messageId), {
          role: String(input.data.role),
          attachments: input.data.attachments,
        });
        return null;
      case "block.started":
        return upgradeBlockStarted(input, blocks);
      case "block.delta":
        return upgradeBlockDelta(input, blocks, messages);
      case "block.completed":
        return upgradeBlockCompleted(input, blocks, messages);
      case "usage.updated":
        return upgradeUsage(input);
      default:
        return null;
    }
  };
}

/** Whether a parsed line looks like an event envelope at all. */
function isRawEvent(input: unknown): input is RawEvent {
  if (typeof input !== "object" || input === null) return false;
  const event = input as { type?: unknown; data?: unknown };
  return typeof event.type === "string" && typeof event.data === "object" && event.data !== null;
}

/** The same envelope with a different type and data. */
function rewrite(input: RawEvent, type: string, data: unknown): RawEvent {
  return { ...input, type, data: data as Record<string, unknown> };
}

/** An ACP update in the envelope of the old event it stands in for. */
function updateEvent(input: RawEvent, update: SessionUpdate): RawEvent {
  return rewrite(input, "update", { update });
}

/** The old permission request named the tool and carried its input directly. */
function isLegacyPermissionRequest(input: RawEvent): boolean {
  return input.type === "permission.requested" && !("request" in input.data);
}

/** A permission request, as the ACP request the new format stores. */
function upgradePermissionRequest(input: RawEvent): RawEvent {
  const toolName = String(input.data.toolName);
  const requestId = String(input.data.requestId);
  const request = {
    sessionId: String(input.sessionId),
    toolCall: {
      toolCallId: requestId,
      name: toolName,
      title: toolName,
      kind: toolKindOfName(toolName),
      status: "pending",
      rawInput: input.data.input,
    },
    options: [],
  };
  return rewrite(input, "permission.requested", { requestId, request });
}

/** The running totals, which the old format called `usage.updated`. */
function upgradeUsage(input: RawEvent): RawEvent {
  const data = input.data;
  return rewrite(input, "usage", {
    total: {
      input: numberOrUndefined(data.inputTokens),
      output: numberOrUndefined(data.outputTokens),
      cacheRead: numberOrUndefined(data.cacheReadTokens),
      costUsd: numberOrUndefined(data.costUsd),
    },
  });
}

/** A string field, or empty when the log has none. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  return "";
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  return undefined;
}

/** A tool call begins as soon as its block does; text and thinking begin with their first delta. */
function upgradeBlockStarted(input: RawEvent, blocks: Map<string, SeenBlock>): RawEvent | null {
  const data = input.data;
  const blockId = String(data.blockId);
  const kind = String(data.kind);
  const toolUseId = typeof data.toolUseId === "string" ? data.toolUseId : null;
  blocks.set(blockId, { kind, messageId: String(data.messageId), streamed: false, toolUseId });
  if (kind !== "tool_use" || toolUseId === null) return null;

  const toolName = textOf(data.toolName);
  return updateEvent(input, {
    sessionUpdate: "tool_call",
    toolCallId: toolUseId,
    name: toolName,
    title: toolName,
    kind: toolKindOfName(toolName),
    status: "pending",
  } as SessionUpdate);
}

/** Streamed text becomes message chunks; streamed tool input is left for the completed block. */
function upgradeBlockDelta(
  input: RawEvent,
  blocks: Map<string, SeenBlock>,
  messages: Map<string, SeenMessage>,
): RawEvent | null {
  const blockId = String(input.data.blockId);
  const block = blocks.get(blockId);
  const text = input.data.textDelta;
  if (block === undefined || typeof text !== "string" || text.length === 0) return null;
  // A prompt is told once, when its block completes.
  if (messages.get(block.messageId)?.role === "user") return null;
  const sessionUpdate = chunkTypeOf(block.kind);
  if (sessionUpdate === null) return null;
  block.streamed = true;
  return updateEvent(input, chunk(sessionUpdate, block.messageId, text));
}

/** The chunk type a block kind is told as, or null for a kind that is not prose. */
function chunkTypeOf(kind: string): "agent_message_chunk" | "agent_thought_chunk" | null {
  if (kind === "text") return "agent_message_chunk";
  if (kind === "thinking") return "agent_thought_chunk";
  return null;
}

function chunk(
  sessionUpdate: "agent_message_chunk" | "agent_thought_chunk",
  messageId: string,
  text: string,
): SessionUpdate {
  return { sessionUpdate, messageId, content: { type: "text", text } } as SessionUpdate;
}

/** A finished block carries the whole of what its deltas streamed, plus what they could not. */
function upgradeBlockCompleted(
  input: RawEvent,
  blocks: Map<string, SeenBlock>,
  messages: Map<string, SeenMessage>,
): RawEvent | null {
  const blockId = String(input.data.blockId);
  const content = input.data.content as Record<string, unknown> | undefined;
  const block = blocks.get(blockId);
  if (block === undefined || content === undefined) return null;

  if (content.kind === "tool_use") return upgradeToolUse(input, content);
  if (content.kind === "tool_result") return upgradeToolResult(input, content);
  if (content.kind !== "text" && content.kind !== "thinking") return null;

  const text = textOf(content.text);
  const message = messages.get(block.messageId);
  if (message?.role === "user" && content.kind === "text") {
    return rewrite(input, "user.message", { text, attachments: message.attachments });
  }
  if (block.streamed || text.length === 0) return null;
  const sessionUpdate = chunkTypeOf(content.kind);
  if (sessionUpdate === null) return null;
  return updateEvent(input, chunk(sessionUpdate, block.messageId, text));
}

/** The call's finished input, with the file changes of an edit told as diffs. */
function upgradeToolUse(input: RawEvent, content: Record<string, unknown>): RawEvent | null {
  const toolUseId = typeof content.toolUseId === "string" ? content.toolUseId : null;
  if (toolUseId === null) return null;
  const toolName = textOf(content.toolName);
  const rawInput = content.input;
  const update: Record<string, unknown> = {
    sessionUpdate: "tool_call_update",
    toolCallId: toolUseId,
    status: "in_progress",
    rawInput,
  };
  const diffs = legacyDiffs(toolName, rawInput);
  if (diffs.length > 0) update.content = diffs;
  const locations = legacyLocations(rawInput);
  if (locations.length > 0) update.locations = locations;
  return updateEvent(input, update as SessionUpdate);
}

/** The call's result, which settles it. */
function upgradeToolResult(input: RawEvent, content: Record<string, unknown>): RawEvent | null {
  const toolUseId = typeof content.toolUseId === "string" ? content.toolUseId : null;
  if (toolUseId === null) return null;
  return updateEvent(input, {
    sessionUpdate: "tool_call_update",
    toolCallId: toolUseId,
    status: content.isError === true ? "failed" : "completed",
    rawOutput: content.output,
  } as SessionUpdate);
}

/** ACP's kind of call for a tool, by the names the three harnesses gave theirs. */
export function toolKindOfName(toolName: string): string {
  const name = toolName.toLowerCase();
  if (["read", "notebookread"].includes(name)) return "read";
  if (["edit", "multiedit", "write", "notebookedit", "apply_patch", "file_change"].includes(name)) {
    return "edit";
  }
  if (
    ["bash", "bashoutput", "killshell", "shell", "exec_command", "command_execution"].includes(name)
  ) {
    return "execute";
  }
  if (["grep", "glob", "ls", "find"].includes(name)) return "search";
  if (["webfetch", "websearch"].includes(name)) return "fetch";
  if (["task", "todowrite"].includes(name)) return "think";
  return "other";
}

/** The file a legacy tool input names, as an ACP location. */
function legacyLocations(rawInput: unknown): Array<{ path: string }> {
  const path = stringField(rawInput, "file_path") ?? stringField(rawInput, "path");
  if (path === undefined) return [];
  return [{ path }];
}

/** Claude's edit tools, as the ACP diffs they would have reported. */
function legacyDiffs(toolName: string, rawInput: unknown): Array<Record<string, unknown>> {
  const path = stringField(rawInput, "file_path") ?? stringField(rawInput, "path");
  if (path === undefined) return [];
  const name = toolName.toLowerCase();
  if (name === "edit") return singleEdit(path, rawInput);
  if (name === "multiedit") return multipleEdits(path, rawInput);
  if (name === "write") {
    const newText = stringField(rawInput, "content");
    if (newText === undefined) return [];
    return [{ type: "diff", path, oldText: null, newText }];
  }
  return [];
}

function singleEdit(path: string, rawInput: unknown): Array<Record<string, unknown>> {
  const oldText = stringField(rawInput, "old_string");
  const newText = stringField(rawInput, "new_string");
  if (oldText === undefined || newText === undefined) return [];
  return [{ type: "diff", path, oldText, newText }];
}

function multipleEdits(path: string, rawInput: unknown): Array<Record<string, unknown>> {
  const edits = (rawInput as { edits?: unknown }).edits;
  if (!Array.isArray(edits)) return [];
  return edits.flatMap((edit) => singleEdit(path, edit));
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  if (typeof field === "string") return field;
  return undefined;
}
