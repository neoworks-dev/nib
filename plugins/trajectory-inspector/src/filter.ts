import { type AnyAgentEvent, isKnownEvent } from "@nib-ui/protocol";

export type EventCategory = "error" | "tool" | "stream" | "state" | "other";

export const eventCategories: { id: EventCategory; label: string }[] = [
  { id: "error", label: "Errors" },
  { id: "tool", label: "Tool calls" },
  { id: "stream", label: "Deltas" },
  { id: "state", label: "State" },
  { id: "other", label: "Other" },
];

/** `block.delta` only carries a block id, so kinds are recovered from the log. */
export function indexBlockKinds(events: AnyAgentEvent[]): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const event of events) {
    if (isKnownEvent(event) && event.type === "block.started")
      kinds.set(event.data.blockId, event.data.kind);
  }
  return kinds;
}

export function categorizeEvent(
  event: AnyAgentEvent,
  blockKinds: Map<string, string>,
): EventCategory {
  if (!isKnownEvent(event)) return "other";
  switch (event.type) {
    case "log":
      return event.data.level === "error" ? "error" : "other";
    case "session.status":
      return event.data.status === "error" ? "error" : "state";
    case "session.created":
    case "session.meta":
    case "session.cleared":
    case "usage.updated":
      return "state";
    case "permission.requested":
    case "permission.resolved":
      return "tool";
    case "block.started":
      return isToolKind(event.data.kind) ? "tool" : "stream";
    case "block.delta":
    case "block.completed":
      return isToolKind(blockKinds.get(event.data.blockId)) ? "tool" : "stream";
    case "message.started":
    case "message.completed":
      return "stream";
    case "ext":
      return "other";
  }
}

/** One line describing the event, used for the row label and the text search. */
export function eventSummary(event: AnyAgentEvent): string {
  if (!isKnownEvent(event)) return event.type;
  switch (event.type) {
    case "session.created":
      return `${event.data.harnessId} · ${event.data.cwd}`;
    case "session.meta":
      return [event.data.label, event.data.model, event.data.permissionMode]
        .filter(Boolean)
        .join(" · ");
    case "session.cleared":
      return event.data.reason ?? "conversation cleared";
    case "session.status":
      return event.data.detail ? `${event.data.status} — ${event.data.detail}` : event.data.status;
    case "message.started":
      return `${event.data.role} ${event.data.messageId}`;
    case "message.completed":
      return event.data.stopReason ?? event.data.messageId;
    case "block.started":
      return `${event.data.kind}${event.data.toolName ? ` · ${event.data.toolName}` : ""}`;
    case "block.delta":
      return (event.data.textDelta ?? event.data.inputJsonDelta ?? "").slice(0, 80);
    case "block.completed":
      return event.data.content.kind;
    case "permission.requested":
      return event.data.toolName;
    case "permission.resolved":
      return `${event.data.behavior} by ${event.data.resolvedBy}`;
    case "usage.updated":
      return `${event.data.inputTokens} in · ${event.data.outputTokens} out`;
    case "log":
      return event.data.message;
    case "ext":
      return `${event.data.ns}/${event.data.type}`;
  }
}

export interface EventFilter {
  categories: EventCategory[];
  query: string;
}

export function filterEvents(events: AnyAgentEvent[], filter: EventFilter): AnyAgentEvent[] {
  const blockKinds = indexBlockKinds(events);
  const query = filter.query.trim().toLowerCase();
  return events.filter((event) => {
    if (
      filter.categories.length > 0 &&
      !filter.categories.includes(categorizeEvent(event, blockKinds))
    )
      return false;
    if (query.length === 0) return true;
    return searchText(event).includes(query);
  });
}

function searchText(event: AnyAgentEvent): string {
  return `${event.type} ${eventSummary(event)} ${JSON.stringify(event.data ?? null)}`.toLowerCase();
}

function isToolKind(kind: string | undefined): boolean {
  return kind === "tool_use" || kind === "tool_result";
}
