import { describe, expect, test } from "bun:test";
import { type LegacyDoc, migrateDocs, parseLegacyDocs } from "../src/migrate";
import type { EdgeObject, WorkstreamObject } from "../src/workstream";

function doc(overrides: Partial<LegacyDoc> = {}): LegacyDoc {
  return {
    rootSessionId: "root",
    branches: [],
    joins: [],
    positions: {},
    annotations: [],
    ...overrides,
  };
}

const inRepo = (sessionId: string) => (sessionId === "gone" ? null : "/repo");

function workstreams(objects: { kind: string }[]): WorkstreamObject[] {
  return objects.filter((object): object is WorkstreamObject => object.kind === "workstream");
}

function edges(objects: { kind: string }[]): EdgeObject[] {
  return objects.filter((object): object is EdgeObject => object.kind === "edge");
}

describe("migrateDocs", () => {
  test("the board is keyed by directory, not by root session", () => {
    const boards = migrateDocs({ root: doc(), other: doc({ rootSessionId: "second" }) }, inRepo);

    expect(boards).toHaveLength(1);
    expect(boards[0]!.cwd).toBe("/repo");
    expect(workstreams(boards[0]!.objects)).toHaveLength(2);
  });

  test("every session the doc spanned becomes one workstream", () => {
    const boards = migrateDocs(
      { root: doc({ branches: [{ sessionId: "side", fromNodeId: "root#1" }] }) },
      inRepo,
    );
    const cards = workstreams(boards[0]!.objects);

    expect(cards.map((card) => card.sessionId)).toEqual(["root", "side"]);
  });

  test("a branch becomes an edge from the owner of the node it hung off", () => {
    const boards = migrateDocs(
      { root: doc({ branches: [{ sessionId: "side", fromNodeId: "root#7" }] }) },
      inRepo,
    );
    const [link] = edges(boards[0]!.objects);

    expect(link!.label).toBe("branch");
    expect(link!.fromId).toBe("workstream:root");
    expect(link!.toId).toBe("workstream:side");
    expect(link!.direction).toBe("forward");
  });

  test("a thread started on empty board space has nothing to link to", () => {
    const boards = migrateDocs(
      { root: doc({ branches: [{ sessionId: "side", fromNodeId: null }] }) },
      inRepo,
    );

    expect(edges(boards[0]!.objects)).toHaveLength(0);
    expect(workstreams(boards[0]!.objects)).toHaveLength(2);
  });

  test("a join keeps one edge per source and stays unlaunched when it never ran", () => {
    const boards = migrateDocs(
      {
        root: doc({
          branches: [{ sessionId: "side", fromNodeId: "root#1" }],
          joins: [
            { id: "join:1", label: "both", sourceIds: ["root#1", "side#1"], sessionId: null },
          ],
        }),
      },
      inRepo,
    );

    const join = workstreams(boards[0]!.objects).find((card) => card.id === "workstream:join:1");
    expect(join!.sessionId).toBeUndefined();
    expect(join!.goal).toBe("both");
    expect(
      edges(boards[0]!.objects)
        .filter((link) => link.label === "join")
        .map((link) => link.fromId)
        .sort(),
    ).toEqual(["workstream:root", "workstream:side"]);
  });

  test("a launched join carries its session onto the card", () => {
    const boards = migrateDocs(
      {
        root: doc({
          joins: [{ id: "join:1", label: "both", sourceIds: ["root#1"], sessionId: "merged" }],
        }),
      },
      inRepo,
    );

    expect(
      workstreams(boards[0]!.objects).find((card) => card.id === "workstream:join:1")!.sessionId,
    ).toBe("merged");
  });

  test("a placed chain keeps the position of its topmost node", () => {
    const boards = migrateDocs(
      { root: doc({ positions: { "root#2": { x: 400, y: 900 }, "root#1": { x: 120, y: 240 } } }) },
      inRepo,
    );
    const [card] = workstreams(boards[0]!.objects);

    expect({ x: card!.x, y: card!.y }).toEqual({ x: 120, y: 240 });
  });

  test("a doc whose root task is gone is skipped", () => {
    expect(migrateDocs({ dead: doc({ rootSessionId: "gone" }) }, inRepo)).toEqual([]);
  });

  test("pinned quotes survive with the turn they were highlighted from", () => {
    const boards = migrateDocs(
      {
        root: doc({
          annotations: [
            { id: "q1", sessionId: "root", messageId: "m4", text: "the bit", note: "why?" },
          ],
        }),
      },
      inRepo,
    );

    expect(boards[0]!.objects.find((object) => object.kind === "annotation")).toEqual({
      kind: "annotation",
      id: "annotation:q1",
      sessionId: "root",
      messageId: "m4",
      text: "the bit",
      note: "why?",
    });
  });

  test("two docs in the same directory land on one board without id collisions", () => {
    const boards = migrateDocs({ a: doc(), b: doc({ rootSessionId: "second" }) }, inRepo);
    const ids = boards[0]!.objects.map((object) => object.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("parseLegacyDocs", () => {
  test("a doc without a root session is not a doc", () => {
    expect(parseLegacyDocs({ broken: { branches: [] } })).toEqual({});
  });

  test("missing arrays and a missing annotations field are tolerated", () => {
    const parsed = parseLegacyDocs({ root: { rootSessionId: "root" } });

    expect(parsed.root).toEqual({
      rootSessionId: "root",
      branches: [],
      joins: [],
      positions: {},
      annotations: [],
    });
  });

  test("positions that are not points are dropped", () => {
    const parsed = parseLegacyDocs({
      root: { rootSessionId: "root", positions: { good: { x: 1, y: 2 }, bad: { x: "no" } } },
    });

    expect(parsed.root!.positions).toEqual({ good: { x: 1, y: 2 } });
  });

  test("anything that is not an object is not storage this build wrote", () => {
    expect(parseLegacyDocs("nonsense")).toEqual({});
    expect(parseLegacyDocs(null)).toEqual({});
  });
});
