import { type AnyAgentEvent, isKnownEvent, toolNameOf } from "@nib-ui/protocol";

export type EventCategory = "error" | "tool" | "stream" | "state" | "other";

export const eventCategories: { id: EventCategory; label: string }[] = [
  { id: "error", label: "Errors" },
  { id: "tool", label: "Tool calls" },
  { id: "stream", label: "Messages" },
  { id: "state", label: "State" },
  { id: "other", label: "Other" },
];

/** Which of the filter's groups an event belongs to. */
export function categorizeEvent(event: AnyAgentEvent): EventCategory {
  if (!isKnownEvent(event)) return "other";
  switch (event.type) {
    case "log":
      return event.data.level === "error" ? "error" : "other";
    case "session.status":
      return event.data.status === "error" ? "error" : "state";
    case "session.created":
    case "session.meta":
    case "session.cleared":
    case "usage":
    case "turn.done":
      return "state";
    case "permission.requested":
    case "permission.resolved":
      return "tool";
    case "user.message":
      return "stream";
    case "update":
      return categorizeUpdate(event.data.update.sessionUpdate);
    case "ext":
      return "other";
  }
}

/** ACP's updates: messages stream, tool calls are tools, the rest is session state. */
function categorizeUpdate(sessionUpdate: string): EventCategory {
  if (sessionUpdate === "agent_message_chunk" || sessionUpdate === "agent_thought_chunk") {
    return "stream";
  }
  if (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") return "tool";
  return "state";
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
    case "user.message":
      return event.data.text.slice(0, 80);
    case "update":
      return updateSummary(event.data.update);
    case "permission.requested":
      return toolNameOf(event.data.request.toolCall) || event.data.request.toolCall.title || "tool";
    case "permission.resolved":
      return `${event.data.behavior} by ${event.data.resolvedBy}`;
    case "usage":
      return `${event.data.total.input ?? 0} in · ${event.data.total.output ?? 0} out`;
    case "turn.done":
      return event.data.stopReason;
    case "log":
      return event.data.message;
    case "ext":
      return `${event.data.ns}/${event.data.type}`;
  }
}

/** What an ACP update says in a line: the chunk's text, the call's name, else its kind. */
function updateSummary(
  update: Extract<AnyAgentEvent, { type: "update" }>["data"]["update"],
): string {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return update.content.type === "text"
        ? update.content.text.slice(0, 80)
        : update.content.type;
    case "tool_call":
    case "tool_call_update": {
      const name = toolNameOf(update);
      const status = update.status ? ` · ${update.status}` : "";
      return `${name || update.title || update.toolCallId}${status}`;
    }
    default:
      return update.sessionUpdate;
  }
}

export interface EventFilter {
  categories: EventCategory[];
  query: string;
}

export function filterEvents(events: AnyAgentEvent[], filter: EventFilter): AnyAgentEvent[] {
  const query = filter.query.trim().toLowerCase();
  return events.filter((event) => {
    if (filter.categories.length > 0 && !filter.categories.includes(categorizeEvent(event))) {
      return false;
    }
    if (query.length === 0) return true;
    return searchText(event).includes(query);
  });
}

function searchText(event: AnyAgentEvent): string {
  return `${event.type} ${eventSummary(event)} ${JSON.stringify(event.data ?? null)}`.toLowerCase();
}
