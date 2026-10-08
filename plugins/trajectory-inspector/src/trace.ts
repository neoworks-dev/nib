import {
  type AnyAgentEvent,
  isKnownEvent,
  parentToolCallOf,
  rawOutputText,
  type SessionUpdate,
  toolNameOf,
} from "@nib-ui/protocol";

export type TraceKind =
  "session" | "message" | "text" | "thinking" | "tool" | "permission" | "state" | "log" | "other";
export type TraceStatus = "streaming" | "ok" | "error";

export interface TraceNode {
  id: string;
  depth: number;
  kind: TraceKind;
  /** Left-hand chip: SYSTEM, USER, ASSISTANT, TOOL, STATE … */
  badge: string;
  title: string;
  detail: string;
  result: string | null;
  status: TraceStatus;
  seq: number;
  ts: number;
  durationMs: number | null;
  turn: number;
  step: number;
  events: AnyAgentEvent[];
}

type UpdateOf<Kind extends SessionUpdate["sessionUpdate"]> = Extract<
  SessionUpdate,
  { sessionUpdate: Kind }
>;

/**
 * Folds the flat log into the call tree it describes: one node per prompt, the
 * agent's messages and tool calls nested underneath, and each tool call carrying
 * the result it produced. Streamed chunks and call updates disappear into the
 * node they belong to.
 */
export function buildTrace(events: AnyAgentEvent[]): TraceNode[] {
  const nodes: TraceNode[] = [];
  const byToolCallId = new Map<string, TraceNode>();
  let openText: TraceNode | null = null;
  let turn = 0;
  let step = 0;

  const push = (node: TraceNode) => {
    nodes.push(node);
    return node;
  };

  /** Ends the message being streamed, with the time it took. */
  const closeText = (ts: number) => {
    if (openText === null) return;
    openText.status = "ok";
    openText.durationMs = ts - openText.ts;
    openText = null;
  };

  for (const event of events) {
    if (!isKnownEvent(event)) {
      push(base(event, { depth: 0, kind: "other", badge: "EXT", title: event.type, turn }));
      continue;
    }

    switch (event.type) {
      case "session.created": {
        push(
          base(event, {
            depth: 0,
            kind: "session",
            badge: "SYSTEM",
            title: event.data.harnessId,
            detail: event.data.cwd,
            turn,
          }),
        );
        break;
      }
      case "session.meta": {
        const detail = [
          event.data.label,
          event.data.model,
          event.data.permissionMode,
          event.data.slashCommands && `${event.data.slashCommands.length} commands`,
          event.data.models && `${event.data.models.length} models`,
        ]
          .filter(Boolean)
          .join(" · ");
        push(
          base(event, {
            depth: 0,
            kind: "state",
            badge: "META",
            title: "session.meta",
            detail,
            turn,
          }),
        );
        break;
      }
      case "session.cleared": {
        closeText(event.ts);
        push(
          base(event, {
            depth: 0,
            kind: "state",
            badge: "STATE",
            title: "session.cleared",
            detail: event.data.reason ?? "",
            turn,
          }),
        );
        break;
      }
      case "session.status": {
        push(
          base(event, {
            depth: 0,
            kind: "state",
            badge: "STATE",
            title: event.data.status,
            detail: event.data.detail ?? "",
            status: event.data.status === "error" ? "error" : "ok",
            turn,
          }),
        );
        break;
      }
      case "user.message": {
        closeText(event.ts);
        turn += 1;
        step = 0;
        push(
          base(event, {
            depth: 0,
            kind: "message",
            badge: "USER",
            title: "user message",
            detail: event.data.text,
            turn,
          }),
        );
        break;
      }
      case "update": {
        const update = event.data.update;
        switch (update.sessionUpdate) {
          case "agent_message_chunk":
          case "agent_thought_chunk": {
            openText = applyChunk(event, update, openText, nodes, turn, (next) => {
              step += 1;
              next.step = step;
            });
            break;
          }
          case "tool_call":
          case "tool_call_update": {
            if (update.sessionUpdate === "tool_call") closeText(event.ts);
            applyToolReport(event, update, byToolCallId, push, turn, () => {
              step += 1;
              return step;
            });
            break;
          }
          default: {
            push(
              base(event, {
                depth: 1,
                kind: "state",
                badge: "ACP",
                title: update.sessionUpdate,
                detail: preview(update),
                turn,
              }),
            );
          }
        }
        break;
      }
      case "permission.requested": {
        const call = event.data.request.toolCall;
        push(
          base(event, {
            depth: 1,
            kind: "permission",
            badge: "PERM",
            title: toolNameOf(call) || call.title || "tool",
            detail: preview(call.rawInput),
            status: "streaming",
            turn,
          }),
        );
        break;
      }
      case "permission.resolved": {
        const node = nodes.findLast((candidate) => candidate.kind === "permission");
        if (node) {
          node.status = event.data.behavior === "allow" ? "ok" : "error";
          node.result = `${event.data.behavior} by ${event.data.resolvedBy}`;
          node.durationMs = event.ts - node.ts;
          node.events.push(event);
        }
        break;
      }
      case "usage": {
        push(
          base(event, {
            depth: 0,
            kind: "state",
            badge: "USAGE",
            title: "usage",
            detail: `${event.data.total.input ?? 0} in · ${event.data.total.output ?? 0} out`,
            turn,
          }),
        );
        break;
      }
      case "turn.done": {
        closeText(event.ts);
        push(
          base(event, {
            depth: 0,
            kind: "state",
            badge: "STATE",
            title: "turn.done",
            detail: event.data.stopReason,
            turn,
          }),
        );
        break;
      }
      case "log": {
        push(
          base(event, {
            depth: 0,
            kind: "log",
            badge: event.data.level.toUpperCase(),
            title: "log",
            detail: event.data.message,
            status: event.data.level === "error" ? "error" : "ok",
            turn,
          }),
        );
        break;
      }
      case "ext": {
        push(
          base(event, {
            depth: 0,
            kind: "other",
            badge: "EXT",
            title: `${event.data.ns}/${event.data.type}`,
            turn,
          }),
        );
        break;
      }
    }
  }

  return nodes;
}

/** Adds a chunk to the message being streamed, or opens a node for a new one. */
function applyChunk(
  event: AnyAgentEvent,
  chunk: UpdateOf<"agent_message_chunk"> | UpdateOf<"agent_thought_chunk">,
  open: TraceNode | null,
  nodes: TraceNode[],
  turn: number,
  numbered: (node: TraceNode) => void,
): TraceNode {
  const kind: TraceKind = chunk.sessionUpdate === "agent_thought_chunk" ? "thinking" : "text";
  const text = chunk.content.type === "text" ? chunk.content.text : "";
  if (open !== null && open.kind === kind) {
    open.detail += text;
    open.events.push(event);
    return open;
  }
  if (open !== null) {
    open.status = "ok";
    open.durationMs = event.ts - open.ts;
  }
  const node = base(event, {
    depth: 1,
    kind,
    badge: "BLOCK",
    title: kind,
    detail: text,
    status: "streaming",
    turn,
  });
  numbered(node);
  nodes.push(node);
  return node;
}

/** Opens a node for a new tool call, or folds an update into the one it belongs to. */
function applyToolReport(
  event: AnyAgentEvent,
  report: UpdateOf<"tool_call"> | UpdateOf<"tool_call_update">,
  byToolCallId: Map<string, TraceNode>,
  push: (node: TraceNode) => TraceNode,
  turn: number,
  nextStep: () => number,
): void {
  let node = byToolCallId.get(report.toolCallId);
  if (node === undefined) {
    node = push(
      base(event, {
        depth: parentToolCallOf(report) === null ? 1 : 2,
        kind: "tool",
        badge: "TOOL",
        title: "tool",
        status: "streaming",
        turn,
        step: nextStep(),
      }),
    );
    byToolCallId.set(report.toolCallId, node);
  } else {
    node.events.push(event);
  }

  const name = toolNameOf(report);
  if (name.length > 0) node.title = name;
  else if (report.title && node.title === "tool") node.title = report.title;
  if (report.rawInput !== undefined && report.rawInput !== null)
    node.detail = preview(report.rawInput);
  const output = rawOutputText(report.rawOutput);
  if (output.length > 0) node.result = output;
  if (report.status === "completed") settle(node, event.ts, "ok");
  if (report.status === "failed") settle(node, event.ts, "error");
}

function settle(node: TraceNode, ts: number, status: TraceStatus): void {
  node.status = status;
  node.durationMs = ts - node.ts;
}

function preview(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function base(
  event: AnyAgentEvent,
  overrides: Partial<TraceNode> & {
    depth: number;
    kind: TraceKind;
    badge: string;
    title: string;
    turn: number;
  },
): TraceNode {
  return {
    id: event.id,
    detail: "",
    result: null,
    status: "ok",
    seq: event.seq,
    ts: event.ts,
    durationMs: null,
    step: 0,
    events: [event],
    ...overrides,
  };
}
