import { describe, expect, test } from "bun:test";
import type { CanvasObject } from "@nib-ui/ui-contracts";
import { planSpawn } from "../src/spawn";
import type { WorkstreamObject } from "../src/workstream";

function workstream(id: string, sessionId?: string): WorkstreamObject {
  return { kind: "workstream", id, goal: id, x: 0, y: 0, ...(sessionId && { sessionId }) };
}

const bookmark: CanvasObject = {
  kind: "bookmark",
  id: "bookmark:1",
  x: 0,
  y: 0,
  url: "https://example.com",
};

describe("planSpawn", () => {
  test("forks the one workstream whose session the harness can fork", () => {
    const plan = planSpawn([workstream("a", "session-a")], () => "native-a");
    expect(plan).toEqual({ kind: "fork", sourceId: "a", nativeSessionId: "native-a" });
  });

  test("branches when the source has no forkable conversation", () => {
    expect(planSpawn([workstream("a", "session-a")], () => null)).toEqual({
      kind: "branch",
      sourceId: "a",
    });
    expect(planSpawn([workstream("a")], () => "native-a")).toEqual({
      kind: "branch",
      sourceId: "a",
    });
  });

  test("joins every workstream when more than one is dragged from", () => {
    const plan = planSpawn([workstream("a", "session-a"), workstream("b")], () => "native-a");
    expect(plan).toEqual({ kind: "join", sourceIds: ["a", "b"] });
  });

  test("a workstream in the selection decides it; the objects beside it are dropped", () => {
    expect(planSpawn([workstream("a", "session-a"), bookmark], () => "native-a")).toEqual({
      kind: "fork",
      sourceId: "a",
      nativeSessionId: "native-a",
    });
  });

  test("with no workstream, the objects are what the task is started from", () => {
    expect(planSpawn([bookmark], () => "native-a")).toEqual({
      kind: "assets",
      sourceIds: ["bookmark:1"],
    });
  });

  test("a link is a relation, not something a task can carry", () => {
    const edge: CanvasObject = { kind: "edge", id: "e1", fromId: "a", toId: "b" };

    expect(planSpawn([edge], () => null)).toBeNull();
    expect(planSpawn([], () => null)).toBeNull();
  });
});
