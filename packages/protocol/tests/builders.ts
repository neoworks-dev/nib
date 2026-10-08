import {
  createSessionView,
  type MessageItem,
  type SessionView,
  toolKindOfName,
  type ToolItem,
  type UserItem,
} from "@nib-ui/protocol";

/** A prompt the user sent. */
export function userItem(id: string, text: string): UserItem {
  return { type: "user", id, seq: 1, text, attachments: [] };
}

/** A finished message from the agent. */
export function textItem(id: string, text: string): MessageItem {
  return {
    type: "text",
    id,
    seq: 1,
    messageId: null,
    text,
    streaming: false,
    parentToolCallId: null,
  };
}

/** A finished thought from the agent. */
export function thoughtItem(id: string, text: string): MessageItem {
  return { ...textItem(id, text), type: "thought" };
}

/** A tool call, with the kind ACP would file it under when the name is one a harness uses. */
export function toolItem(
  toolCallId: string,
  name: string,
  rawInput: unknown,
  overrides: Partial<ToolItem> = {},
): ToolItem {
  return {
    type: "tool",
    id: toolCallId,
    toolCallId,
    seq: 1,
    name,
    title: "",
    kind: toolKindOfName(name),
    status: "completed",
    rawInput,
    rawOutput: undefined,
    content: [],
    locations: [],
    terminal: null,
    parentToolCallId: null,
    ...overrides,
  };
}

/** A session holding these items. */
export function sessionOf(
  sessionId: string,
  items: SessionView["items"],
  overrides: Partial<SessionView> = {},
): SessionView {
  return { ...createSessionView(sessionId), items, ...overrides };
}
