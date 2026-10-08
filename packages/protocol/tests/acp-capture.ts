import type { HarnessEvent, RequestPermissionRequest } from "@neoworks/harness";
import {
  type AnyAgentEvent,
  createSessionView,
  type EmittedEvent,
  HarnessEventLog,
  reduceSessionAll,
  type SessionView,
} from "@nib-ui/protocol";

/** One line of a recording made against the real harnesses. */
type CaptureLine =
  | { kind: "event"; event: HarnessEvent }
  | { kind: "onPermission"; request: RequestPermissionRequest };

/** Stamps emitted events the way the session host does. */
export function stamp(sessionId: string, emitted: EmittedEvent[], startSeq = 0): AnyAgentEvent[] {
  return emitted.map((event, index) => ({
    id: `${sessionId}-${startSeq + index + 1}`,
    sessionId,
    seq: startSeq + index + 1,
    ts: 1000 + startSeq + index,
    ...event,
  })) as AnyAgentEvent[];
}

/**
 * A recorded harness stream as the log it would have produced: a prompt, then
 * every harness event through the same `HarnessEventLog` the server uses, with
 * the permission request logged where the harness asked for it.
 */
export async function loggedCapture(name: string, prompt: string): Promise<AnyAgentEvent[]> {
  const path = new URL(`./fixtures/acp-${name}.jsonl`, import.meta.url).pathname;
  const lines = (await Bun.file(path).text())
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CaptureLine);

  const log = new HarnessEventLog();
  const emitted: EmittedEvent[] = [
    { type: "user.message", data: { text: prompt } },
    { type: "session.status", data: { status: "working" } },
  ];
  let turnEnded = false;
  for (const line of lines) {
    // The recordings hold two prompts; the second is not in them, so it is
    // logged where the next turn begins.
    if (turnEnded && line.kind === "event") {
      emitted.push({ type: "user.message", data: { text: "again" } });
      emitted.push({ type: "session.status", data: { status: "working" } });
      turnEnded = false;
    }
    if (line.kind === "event" && line.event.type === "done") turnEnded = true;
    if (line.kind === "event") emitted.push(...log.events(line.event));
    if (line.kind === "onPermission") {
      emitted.push({
        type: "permission.requested",
        data: { requestId: line.request.toolCall.toolCallId, request: line.request },
      });
    }
  }
  return stamp(name, emitted);
}

/** Folds events into a view of a fresh session. */
export function project(sessionId: string, events: AnyAgentEvent[]): SessionView {
  return reduceSessionAll(createSessionView(sessionId), events);
}
