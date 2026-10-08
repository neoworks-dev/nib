import { type AnyAgentEvent, isKnownEvent, type SessionUpdate } from "@nib-ui/protocol";

export interface TrajectoryRow {
  event: AnyAgentEvent;
  /** How many raw events this row stands for; 1 for everything but merged chunks. */
  mergedCount: number;
  firstSeq: number;
}

type ChunkUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }
>;

/**
 * A streamed answer is hundreds of one-token chunks. Consecutive chunks of the
 * same message become one row carrying the concatenated text, so the log stays
 * readable while the payload pane still shows the whole message.
 */
export function mergeDeltas(events: AnyAgentEvent[]): TrajectoryRow[] {
  const rows: TrajectoryRow[] = [];

  for (const event of events) {
    const previous = rows[rows.length - 1];
    const chunk = chunkOf(event);
    const previousChunk = previous ? chunkOf(previous.event) : null;
    if (
      !previous ||
      chunk === null ||
      previousChunk === null ||
      !sameMessage(previousChunk, chunk)
    ) {
      rows.push({ event, mergedCount: 1, firstSeq: event.seq });
      continue;
    }

    rows[rows.length - 1] = {
      event: { ...event, data: { update: concatenated(previousChunk, chunk) } },
      mergedCount: previous.mergedCount + 1,
      firstSeq: previous.firstSeq,
    };
  }

  return rows;
}

/** The chunk an event carries, or null when it carries anything else. */
function chunkOf(event: AnyAgentEvent): ChunkUpdate | null {
  if (!isKnownEvent(event) || event.type !== "update") return null;
  const update = event.data.update;
  if (
    update.sessionUpdate !== "agent_message_chunk" &&
    update.sessionUpdate !== "agent_thought_chunk"
  ) {
    return null;
  }
  if (update.content.type !== "text") return null;
  return update;
}

function sameMessage(left: ChunkUpdate, right: ChunkUpdate): boolean {
  if (left.sessionUpdate !== right.sessionUpdate) return false;
  return (left.messageId ?? null) === (right.messageId ?? null);
}

/** The two chunks' text as one chunk; the later chunk's other fields win. */
function concatenated(left: ChunkUpdate, right: ChunkUpdate): ChunkUpdate {
  const leftText = left.content.type === "text" ? left.content.text : "";
  const rightText = right.content.type === "text" ? right.content.text : "";
  return { ...right, content: { type: "text", text: `${leftText}${rightText}` } };
}
