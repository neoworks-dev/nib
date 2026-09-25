import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardDoc, PaneLayout } from "@nib-ui/ui-contracts";
import {
  boardFileName,
  boardSummary,
  listBoardFiles,
  parseBoard,
  readBoardFile,
  StaleBoardWriteError,
  writeBoardFile,
} from "../src/lib/server/board-store";

const cwd = "/home/dev/repo";

function board(rev: number, objects: BoardDoc["objects"] = []): BoardDoc {
  return { version: 1, rev, cwd, objects, placements: {}, stacks: {} };
}

describe("boardFileName", () => {
  it("is stable for a directory and different for another", () => {
    expect(boardFileName(cwd)).toBe(boardFileName(cwd));
    expect(boardFileName(cwd)).not.toBe(boardFileName("/home/dev/other"));
    expect(boardFileName(cwd)).toMatch(/^[0-9a-f]{64}\.json$/);
  });
});

describe("parseBoard", () => {
  it("an object whose kind no plugin claims is kept as it was found", () => {
    const raw = {
      version: 1,
      rev: 3,
      cwd,
      objects: [{ kind: "hologram", id: "h1", spin: 4, nested: { deep: true } }],
    };

    expect(parseBoard(raw, cwd).objects).toEqual(raw.objects);
  });

  it("drops entries without a kind and an id, which nothing could ever address", () => {
    const parsed = parseBoard(
      { objects: [{ kind: "note" }, { id: "n" }, 7, null, { kind: "note", id: "n" }] },
      cwd,
    );

    expect(parsed.objects).toEqual([{ kind: "note", id: "n" }]);
  });

  it("keeps the first of two objects sharing an id", () => {
    const parsed = parseBoard(
      {
        objects: [
          { kind: "note", id: "n", body: "first" },
          { kind: "note", id: "n", body: "second" },
        ],
      },
      cwd,
    );

    expect(parsed.objects).toHaveLength(1);
    expect(parsed.objects[0]!.body).toBe("first");
  });

  it("a corrupt revision reads as a fresh board rather than a negative one", () => {
    expect(parseBoard({ rev: -4 }, cwd).rev).toBe(0);
    expect(parseBoard({ rev: "soon" }, cwd).rev).toBe(0);
  });

  it("anything that is not a board is an empty board for the directory", () => {
    expect(parseBoard("nonsense", cwd)).toEqual({
      version: 1,
      rev: 0,
      cwd,
      objects: [],
      placements: {},
      stacks: {},
    });
  });
});

describe("parseBoard layout", () => {
  const layout: PaneLayout = {
    docks: [
      {
        edge: "right",
        size: 0.3,
        root: {
          kind: "split",
          axis: "column",
          sizes: [0.6, 0.4],
          children: [
            { kind: "leaf", instanceId: "i1" },
            { kind: "leaf", instanceId: "i2" },
          ],
        },
      },
    ],
    instances: [
      { instanceId: "i1", paneId: "git" },
      { instanceId: "i2", paneId: "chat", params: { sessionId: "s1" } },
    ],
  };

  it("round-trips the docks, the tree and each instance with its params", () => {
    expect(parseBoard({ rev: 2, cwd, objects: [], layout }, cwd).layout).toEqual(layout);
  });

  it("a board without a layout has none rather than an empty one", () => {
    expect(parseBoard({ rev: 1, cwd, objects: [] }, cwd).layout).toBeUndefined();
    expect(parseBoard({ layout: "nonsense" }, cwd).layout).toBeUndefined();
    expect(parseBoard({ layout: { docks: [], instances: [] } }, cwd).layout).toBeUndefined();
  });

  it("a layout written by a build that floated its panes opens with none", () => {
    expect(
      parseBoard(
        {
          layout: {
            instances: layout.instances,
            frames: [
              {
                frameId: "f1",
                rect: { x: 0, y: 0, width: 300, height: 200 },
                root: { kind: "leaf", instanceId: "i1" },
              },
            ],
          },
        },
        cwd,
      ).layout,
    ).toBeUndefined();
  });

  it("a leaf naming an instance the layout does not list is dropped", () => {
    const parsed = parseBoard(
      {
        layout: {
          ...layout,
          docks: [
            {
              ...layout.docks[0],
              root: {
                kind: "split",
                axis: "row",
                sizes: [0.5, 0.5],
                children: [
                  { kind: "leaf", instanceId: "i1" },
                  { kind: "leaf", instanceId: "ghost" },
                ],
              },
            },
          ],
        },
      },
      cwd,
    );

    expect(parsed.layout?.docks[0]!.root).toEqual({ kind: "leaf", instanceId: "i1" });
    expect(parsed.layout?.instances).toEqual([{ instanceId: "i1", paneId: "git" }]);
  });

  it("a dock with no edge, no size or an unreadable tree is dropped, not the whole layout", () => {
    const parsed = parseBoard(
      {
        layout: {
          instances: layout.instances,
          docks: [
            { edge: "middle", size: 0.3, root: { kind: "leaf", instanceId: "i1" } },
            { edge: "left", size: "wide", root: { kind: "leaf", instanceId: "i1" } },
            { edge: "top", size: 0.3, root: { kind: "tabs" } },
            { edge: "bottom", size: 0.25, root: { kind: "leaf", instanceId: "i2" } },
          ],
        },
      },
      cwd,
    );

    expect(parsed.layout?.docks.map((dock) => dock.edge)).toEqual(["bottom"]);
    expect(parsed.layout?.instances).toEqual([
      { instanceId: "i2", paneId: "chat", params: { sessionId: "s1" } },
    ]);
  });

  it("an instance claimed by two docks is only rendered by the first", () => {
    const parsed = parseBoard(
      {
        layout: {
          instances: layout.instances,
          docks: [
            { edge: "right", size: 0.3, root: { kind: "leaf", instanceId: "i1" } },
            { edge: "left", size: 0.3, root: { kind: "leaf", instanceId: "i1" } },
          ],
        },
      },
      cwd,
    );

    expect(parsed.layout?.docks.map((dock) => dock.edge)).toEqual(["right"]);
  });

  it("two docks against one edge keep only the first: an edge holds one", () => {
    const parsed = parseBoard(
      {
        layout: {
          instances: layout.instances,
          docks: [
            { edge: "right", size: 0.3, root: { kind: "leaf", instanceId: "i1" } },
            { edge: "right", size: 0.5, root: { kind: "leaf", instanceId: "i2" } },
          ],
        },
      },
      cwd,
    );

    expect(parsed.layout?.docks).toHaveLength(1);
    expect(parsed.layout?.instances).toEqual([{ instanceId: "i1", paneId: "git" }]);
  });

  it("sizes are repaired to fractions of the split, whatever was stored", () => {
    const parsed = parseBoard(
      {
        layout: {
          instances: layout.instances,
          docks: [{ ...layout.docks[0], root: { ...layout.docks[0]!.root, sizes: [3, "wide"] } }],
        },
      },
      cwd,
    );

    const root = parsed.layout?.docks[0]!.root;
    expect(root?.kind === "split" && root.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(
      1,
    );
    expect(root?.kind === "split" && root.sizes[0]).toBeGreaterThan(
      root?.kind === "split" ? root.sizes[1]! : 1,
    );
  });

  it("a split left with one child is that child", () => {
    const parsed = parseBoard(
      {
        layout: {
          instances: [{ instanceId: "i1", paneId: "git" }],
          docks: [
            {
              ...layout.docks[0],
              root: {
                kind: "split",
                axis: "column",
                sizes: [1],
                children: [{ kind: "leaf", instanceId: "i1" }],
              },
            },
          ],
        },
      },
      cwd,
    );

    expect(parsed.layout?.docks[0]!.root).toEqual({ kind: "leaf", instanceId: "i1" });
  });
});

describe("board files", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "nib-boards-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("a directory with no board yet reads as an empty one", async () => {
    expect(await readBoardFile(directory, cwd)).toEqual({
      version: 1,
      rev: 0,
      cwd,
      objects: [],
      placements: {},
      stacks: {},
    });
  });

  it("accepts exactly the next revision and reads it back", async () => {
    await writeBoardFile(
      directory,
      board(1, [{ kind: "workstream", id: "w", goal: "", x: 0, y: 0 }]),
    );
    const stored = await readBoardFile(directory, cwd);

    expect(stored.rev).toBe(1);
    expect(stored.objects).toHaveLength(1);
  });

  it("rejects a stale write and reports the revision the writer is behind", async () => {
    await writeBoardFile(directory, board(1));
    await writeBoardFile(directory, board(2));

    const failure = writeBoardFile(directory, board(2));
    await expect(failure).rejects.toBeInstanceOf(StaleBoardWriteError);
    await failure.catch((error: StaleBoardWriteError) => expect(error.current).toBe(2));
  });

  it("rejects a skipped revision as well as a stale one", async () => {
    await writeBoardFile(directory, board(1));
    await expect(writeBoardFile(directory, board(3))).rejects.toBeInstanceOf(StaleBoardWriteError);
    expect((await readBoardFile(directory, cwd)).rev).toBe(1);
  });

  it("leaves no temporary file behind, so the board is one file per directory", async () => {
    await writeBoardFile(directory, board(1));

    expect(readdirSync(directory)).toEqual([boardFileName(cwd)]);
  });

  it("a board file that is not JSON is replaced rather than failing the write", async () => {
    writeFileSync(join(directory, boardFileName(cwd)), "half a bo", "utf8");

    await writeBoardFile(directory, board(1, [{ kind: "note", id: "n", x: 0, y: 0, body: "hi" }]));
    expect((await readBoardFile(directory, cwd)).objects).toHaveLength(1);
  });

  it("the pane layout survives the write and reads back with the board", async () => {
    const layout: BoardDoc["layout"] = {
      docks: [{ edge: "right", size: 0.3, root: { kind: "leaf", instanceId: "i1" } }],
      instances: [{ instanceId: "i1", paneId: "git" }],
    };

    await writeBoardFile(directory, { ...board(1), layout });

    expect((await readBoardFile(directory, cwd)).layout).toEqual(layout);
  });

  it("a board saved with no layout keeps the key out of the file", async () => {
    await writeBoardFile(directory, board(1));
    const raw = JSON.parse(readFileSync(join(directory, boardFileName(cwd)), "utf8")) as Record<
      string,
      unknown
    >;

    expect("layout" in raw).toBe(false);
  });

  it("two directories keep separate boards", async () => {
    await writeBoardFile(directory, board(1, [{ kind: "note", id: "a", x: 0, y: 0, body: "a" }]));
    await writeBoardFile(directory, {
      version: 1,
      rev: 1,
      cwd: "/other",
      objects: [],
      placements: {},
      stacks: {},
    });

    expect((await readBoardFile(directory, cwd)).objects).toHaveLength(1);
    expect((await readBoardFile(directory, "/other")).objects).toHaveLength(0);
  });

  it("lists every board, reading each directory out of its document", async () => {
    await writeBoardFile(directory, board(1));
    await writeBoardFile(directory, {
      version: 1,
      rev: 1,
      cwd: "/other",
      objects: [],
      placements: {},
      stacks: {},
    });

    expect((await listBoardFiles(directory)).map((entry) => entry.cwd).sort()).toEqual([
      "/home/dev/repo",
      "/other",
    ]);
  });

  it("a board that will not parse costs its own row, not the listing", async () => {
    await writeBoardFile(directory, board(1));
    writeFileSync(join(directory, "broken.json"), "{ not json");

    expect(await listBoardFiles(directory)).toHaveLength(1);
  });

  it("lists nothing when no board has been written yet", async () => {
    expect(await listBoardFiles(join(directory, "missing"))).toEqual([]);
  });
});

describe("boardSummary", () => {
  it("reduces a board to its workstreams and leaves everything else out", () => {
    const summary = boardSummary(
      board(4, [
        { kind: "workstream", id: "w1", x: 0, y: 0, goal: "Ship", sessionId: "s1", reviewedAt: 12 },
        { kind: "media", id: "m1", x: 0, y: 0 },
        { kind: "workstream", id: "w2", x: 0, y: 0, goal: "" },
      ]),
    );

    expect(summary).toEqual({
      cwd,
      rev: 4,
      workstreams: [
        { id: "w1", goal: "Ship", sessionId: "s1", reviewedAt: 12 },
        { id: "w2", goal: "", sessionId: null, reviewedAt: null },
      ],
    });
  });

  it("reads a board written before the review mark existed as unreviewed", () => {
    const summary = boardSummary(
      board(1, [{ kind: "workstream", id: "w1", x: 0, y: 0, goal: "a", reviewedAt: "yes" }]),
    );

    expect(summary.workstreams[0]?.reviewedAt).toBeNull();
  });
});
