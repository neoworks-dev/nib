import { describe, expect, test } from "bun:test";
import { type AnyAgentEvent, parseAgentEvent } from "@nib-ui/protocol";
import { categorizeEvent, eventSummary, filterEvents } from "../src/filter";
import { mergeDeltas } from "../src/merge-deltas";

let seq = 0;
function event(type: string, data: unknown): AnyAgentEvent {
  seq += 1;
  return parseAgentEvent({ id: `e${seq}`, sessionId: "s1", seq, ts: seq, type, data });
}

function update(value: unknown): AnyAgentEvent {
  return event("update", { update: value });
}

function chunk(text: string, messageId?: string): AnyAgentEvent {
  return update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
    ...(messageId && { messageId }),
  });
}

const log: AnyAgentEvent[] = [
  event("session.status", { status: "working" }),
  chunk("hello world"),
  update({ sessionUpdate: "tool_call", toolCallId: "t1", name: "Bash", kind: "execute" }),
  update({ sessionUpdate: "tool_call_update", toolCallId: "t1", rawInput: { command: "ls" } }),
  event("permission.requested", {
    requestId: "p1",
    request: { sessionId: "n", toolCall: { toolCallId: "t1", name: "Bash" }, options: [] },
  }),
  event("log", { level: "error", message: "spawn failed" }),
  event("harness.telepathy", { thought: "unknown to this build" }),
];

describe("categorizeEvent", () => {
  test("chunks are messages and tool call reports are tools", () => {
    expect(categorizeEvent(log[1]!)).toBe("stream");
    expect(categorizeEvent(log[2]!)).toBe("tool");
    expect(categorizeEvent(log[3]!)).toBe("tool");
    expect(categorizeEvent(update({ sessionUpdate: "plan", entries: [] }))).toBe("state");
  });

  test("errors win over the state category", () => {
    expect(categorizeEvent(log[5]!)).toBe("error");
    expect(categorizeEvent(event("session.status", { status: "error", detail: "boom" }))).toBe(
      "error",
    );
    expect(categorizeEvent(log[0]!)).toBe("state");
  });

  test('unknown event types stay visible as "other"', () => {
    expect(categorizeEvent(log[6]!)).toBe("other");
  });
});

describe("filterEvents", () => {
  test("no categories selected means no category filtering", () => {
    expect(filterEvents(log, { categories: [], query: "" })).toHaveLength(log.length);
  });

  test("category selection is a union", () => {
    const filtered = filterEvents(log, { categories: ["tool", "error"], query: "" });
    expect(filtered.map((entry) => entry.type)).toEqual([
      "update",
      "update",
      "permission.requested",
      "log",
    ]);
  });

  test("search matches the payload as well as the type", () => {
    expect(
      filterEvents(log, { categories: [], query: "hello world" }).map((entry) => entry.seq),
    ).toEqual([log[1]!.seq]);
    expect(filterEvents(log, { categories: [], query: "permission" })).toHaveLength(1);
    expect(filterEvents(log, { categories: [], query: "telepathy" })).toHaveLength(1);
  });

  test("search and categories combine", () => {
    expect(filterEvents(log, { categories: ["stream"], query: "ls" })).toHaveLength(0);
  });
});

describe("eventSummary", () => {
  test("describes known events and falls back to the type", () => {
    expect(eventSummary(log[1]!)).toBe("hello world");
    expect(eventSummary(log[2]!)).toBe("Bash");
    expect(eventSummary(log[4]!)).toBe("Bash");
    expect(eventSummary(log[5]!)).toBe("spawn failed");
    expect(eventSummary(log[6]!)).toBe("harness.telepathy");
  });
});

describe("mergeDeltas", () => {
  const text = (row: { event: AnyAgentEvent }): string => {
    const { update: merged } = row.event.data as {
      update: { content: { text: string } };
    };
    return merged.content.text;
  };

  test("folds consecutive chunks of one message into a single row", () => {
    const events = [chunk("He", "m1"), chunk("llo", "m1"), chunk("!", "m1")];
    const rows = mergeDeltas(events);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.mergedCount).toBe(3);
    expect(rows[0]!.firstSeq).toBe(events[0]!.seq);
    expect(text(rows[0]!)).toBe("Hello!");
  });

  test("breaks the run on a different message or another event type", () => {
    const rows = mergeDeltas([
      chunk("a", "m1"),
      chunk("b", "m2"),
      event("session.status", { status: "idle" }),
      chunk("c", "m2"),
    ]);

    expect(rows.map((row) => row.mergedCount)).toEqual([1, 1, 1, 1]);
    expect(rows.map((row) => row.event.type)).toEqual([
      "update",
      "update",
      "session.status",
      "update",
    ]);
  });

  test("leaves a log without chunks untouched", () => {
    const events: AnyAgentEvent[] = [
      {
        id: "e1",
        sessionId: "s1",
        seq: 1,
        ts: 1,
        type: "log",
        data: { level: "info", message: "hi" },
      },
    ];
    expect(mergeDeltas(events)).toEqual([{ event: events[0]!, mergedCount: 1, firstSeq: 1 }]);
  });
});
