import { describe, expect, it } from "bun:test";
import type { SessionSummary } from "@nib-ui/ui-contracts";
import { agentFamily } from "../src/agent-family";

function summary(id: string, parentSessionId: string | null, createdAt: number): SessionSummary {
  return {
    id,
    harnessId: "claude-code",
    cwd: "/repo",
    title: id,
    status: "idle",
    model: null,
    archived: false,
    createdAt,
    updatedAt: createdAt,
    lastSeq: 0,
    live: true,
    resumable: true,
    nativeSessionId: null,
    parentSessionId,
    digest: { prompt: null, reply: null, recent: [] },
  };
}

const ids = (family: SessionSummary[]): string[] => family.map((entry) => entry.id);

describe("the family one agent belongs to", () => {
  it("is the session alone when it has no relatives", () => {
    const summaries = [summary("solo", null, 1), summary("other", null, 2)];
    expect(ids(agentFamily(summaries, "solo"))).toEqual(["solo"]);
  });

  it("is empty for a session the list does not hold", () => {
    expect(agentFamily([summary("root", null, 1)], "missing")).toEqual([]);
  });

  it("reads the same from any member: root first, then its agents", () => {
    const summaries = [
      summary("child", "root", 2),
      summary("root", null, 1),
      summary("grandchild", "child", 3),
    ];
    expect(ids(agentFamily(summaries, "grandchild"))).toEqual(["root", "child", "grandchild"]);
    expect(ids(agentFamily(summaries, "root"))).toEqual(["root", "child", "grandchild"]);
  });

  it("puts a parent before its children and orders siblings by age", () => {
    const summaries = [
      summary("root", null, 1),
      summary("second", "root", 3),
      summary("first", "root", 2),
      summary("second-child", "second", 4),
    ];
    expect(ids(agentFamily(summaries, "root"))).toEqual([
      "root",
      "first",
      "second",
      "second-child",
    ]);
  });

  it("leaves other families out", () => {
    const summaries = [
      summary("root", null, 1),
      summary("child", "root", 2),
      summary("elsewhere", null, 3),
      summary("elsewhere-child", "elsewhere", 4),
    ];
    expect(ids(agentFamily(summaries, "child"))).toEqual(["root", "child"]);
  });

  it("treats a session whose parent is gone as the root of what is left", () => {
    const summaries = [summary("orphan", "deleted", 2), summary("child", "orphan", 3)];
    expect(ids(agentFamily(summaries, "child"))).toEqual(["orphan", "child"]);
  });

  it("terminates on a parent cycle", () => {
    const summaries = [summary("a", "b", 1), summary("b", "a", 2)];
    expect(ids(agentFamily(summaries, "a")).sort()).toEqual(["a", "b"]);
  });
});
