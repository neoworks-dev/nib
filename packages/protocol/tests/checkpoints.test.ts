import { describe, expect, test } from "bun:test";
import {
  type AnyAgentEvent,
  checkpointBefore,
  createSessionView,
  type EmittedEvent,
  reduceSessionAll,
  type SessionView,
} from "@nib-ui/protocol";

function project(emitted: EmittedEvent[]): SessionView {
  const events = emitted.map(
    (event, index) =>
      ({
        id: `e${index}`,
        sessionId: "s1",
        seq: index + 1,
        ts: 1000 + index,
        ...event,
      }) as AnyAgentEvent,
  );
  return reduceSessionAll(createSessionView("s1"), events);
}

const turn: EmittedEvent[] = [
  { type: "message.started", data: { messageId: "u1", role: "user" } },
  { type: "message.checkpoint", data: { messageId: "u1", checkpointId: "uuid-1" } },
  { type: "message.completed", data: { messageId: "u1" } },
  { type: "message.started", data: { messageId: "a1", role: "assistant" } },
  { type: "message.completed", data: { messageId: "a1" } },
];

describe("checkpoints", () => {
  test("a checkpoint event indexes its message", () => {
    expect(project(turn).checkpoints).toEqual({ u1: "uuid-1" });
  });

  test("an assistant turn resolves to the prompt that caused it", () => {
    expect(checkpointBefore(project(turn), "a1")).toBe("uuid-1");
  });

  test("a turn before any checkpoint has none", () => {
    const view = project([
      { type: "message.started", data: { messageId: "a0", role: "assistant" } },
      { type: "message.completed", data: { messageId: "a0" } },
      ...turn,
    ]);
    expect(checkpointBefore(view, "a0")).toBeNull();
  });

  test("an unknown message has none", () => {
    expect(checkpointBefore(project(turn), "nope")).toBeNull();
  });
});

describe("session.meta partials", () => {
  test("effort and the archived flag survive an update that omits them", () => {
    const view = project([
      { type: "session.meta", data: { effort: "max", archived: true } },
      { type: "session.meta", data: { model: "opus" } },
    ]);
    expect(view.effort).toBe("max");
    expect(view.archived).toBe(true);
    expect(view.model).toBe("opus");
  });

  test("archiving is reversible", () => {
    const view = project([
      { type: "session.meta", data: { archived: true } },
      { type: "session.meta", data: { archived: false } },
    ]);
    expect(view.archived).toBe(false);
  });
});
