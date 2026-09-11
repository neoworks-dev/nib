import { type AnyAgentEvent, type BlockContent, isKnownEvent } from "@nib-ui/protocol";

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

/**
 * Folds the flat log into the call tree it describes: one node per message, its
 * blocks nested underneath, and each tool call carrying the result it produced.
 * Deltas disappear into the node they were streaming into.
 */
export function buildTrace(events: AnyAgentEvent[]): TraceNode[] {
  const nodes: TraceNode[] = [];
  const byBlockId = new Map<string, TraceNode>();
  const byToolUseId = new Map<string, TraceNode>();
  const byMessageId = new Map<string, TraceNode>();
  const turnByMessageId = new Map<string, number>();
  const stepByMessageId = new Map<string, number>();
  let turn = 0;

  const push = (node: TraceNode) => {
    nodes.push(node);
    return node;
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
      case "message.started": {
        turn += 1;
        turnByMessageId.set(event.data.messageId, turn);
        stepByMessageId.set(event.data.messageId, 0);
        byMessageId.set(
          event.data.messageId,
          push(
            base(event, {
              depth: 0,
              kind: "message",
              badge: event.data.role.toUpperCase(),
              title: event.data.role === "user" ? "user message" : "assistant message",
              status: "streaming",
              turn,
            }),
          ),
        );
        break;
      }
      case "message.completed": {
        const node = byMessageId.get(event.data.messageId);
        if (node) {
          node.status = "ok";
          node.detail = event.data.stopReason ?? node.detail;
          node.durationMs = event.ts - node.ts;
          node.events.push(event);
        }
        break;
      }
      case "block.started": {
        // A result block is not its own step: it completes the call that opened the id.
        const call =
          event.data.kind === "tool_result"
            ? byToolUseId.get(event.data.toolUseId ?? "")
            : undefined;
        if (call) {
          byBlockId.set(event.data.blockId, call);
          call.events.push(event);
          break;
        }

        const messageTurn = turnByMessageId.get(event.data.messageId) ?? turn;
        const step = (stepByMessageId.get(event.data.messageId) ?? 0) + 1;
        stepByMessageId.set(event.data.messageId, step);
        const node = push(
          base(event, {
            depth: 1,
            kind: blockKind(event.data.kind),
            badge: isToolKind(event.data.kind) ? "TOOL" : "BLOCK",
            title: event.data.toolName ?? event.data.kind,
            status: "streaming",
            turn: messageTurn,
            step,
          }),
        );
        byBlockId.set(event.data.blockId, node);
        if (event.data.toolUseId) byToolUseId.set(event.data.toolUseId, node);
        break;
      }
      case "block.delta": {
        const node = byBlockId.get(event.data.blockId);
        if (!node) break;
        node.detail += event.data.textDelta ?? event.data.inputJsonDelta ?? "";
        node.events.push(event);
        break;
      }
      case "block.completed": {
        const node = byBlockId.get(event.data.blockId);
        if (!node) break;
        node.events.push(event);
        applyContent(node, event.data.content, event.ts);
        break;
      }
      case "permission.requested": {
        push(
          base(event, {
            depth: 1,
            kind: "permission",
            badge: "PERM",
            title: event.data.toolName,
            detail: preview(event.data.input),
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
      case "usage.updated": {
        push(
          base(event, {
            depth: 0,
            kind: "state",
            badge: "USAGE",
            title: "usage",
            detail: `${event.data.inputTokens} in · ${event.data.outputTokens} out`,
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

function isToolKind(kind: string): boolean {
  return kind === "tool_use" || kind === "tool_result";
}

function applyContent(node: TraceNode, content: BlockContent, ts: number): void {
  node.durationMs = ts - node.ts;
  node.status = "ok";
  // `BlockContent` stays open for unknown kinds, so each branch reads its own fields.
  if (content.kind === "tool_use") {
    const call = content as { toolName?: string; input?: unknown };
    node.title = call.toolName ?? node.title;
    node.detail = preview(call.input);
    return;
  }
  if (content.kind === "tool_result") {
    const result = content as { output?: unknown; isError?: boolean };
    node.result = preview(result.output);
    if (result.isError) node.status = "error";
    return;
  }
  if (content.kind === "text" || content.kind === "thinking") {
    node.detail = (content as { text?: string }).text ?? "";
  }
}

function blockKind(kind: string): TraceKind {
  if (kind === "text") return "text";
  if (kind === "thinking") return "thinking";
  if (kind === "tool_use" || kind === "tool_result") return "tool";
  return "other";
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
