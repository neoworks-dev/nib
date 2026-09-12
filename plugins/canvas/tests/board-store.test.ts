import { describe, expect, it } from "bun:test";
import type { CanvasObject } from "@nib-ui/ui-contracts";
import { BoardStore } from "../src/board.svelte";

/**
 * No transport is attached, so nothing is saved and nothing is streamed: what is
 * under test is the document and the undo stack over it.
 */
function store(): BoardStore {
  const board = new BoardStore();
  board.doc = { version: 1, rev: 0, cwd: "/work/project", objects: [], placements: {} };
  return board;
}

function card(id: string, x = 0): CanvasObject {
  return { kind: "workstream", id, goal: "", x, y: 0 };
}

describe("BoardStore objects", () => {
  it("puts the vault's cards after the authored ones", () => {
    const board = store();
    board.addObject(card("w1"));
    board.vault = [
      {
        kind: "sticky",
        id: "a.md",
        path: "a.md",
        name: "a",
        title: null,
        preview: "",
        truncated: false,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        z: 0,
      },
    ];

    expect(board.objects.map((object) => object.id)).toEqual(["w1", "a.md"]);
  });

  it("returns the same array until one half changes", () => {
    const board = store();
    board.addObject(card("w1"));

    const first = board.objects;
    expect(board.objects).toBe(first);

    board.vault = [];
    expect(board.objects).toBe(first);
  });
});

describe("BoardStore history", () => {
  it("undoes and redoes an authored change", () => {
    const board = store();
    board.addObject(card("w1"));
    expect(board.doc.objects).toHaveLength(1);

    board.undo();
    expect(board.doc.objects).toHaveLength(0);

    board.redo();
    expect(board.doc.objects.map((object) => object.id)).toEqual(["w1"]);
  });

  it("covers the placements map, so dragging a vault card is undoable", () => {
    const board = store();
    const close = board.beginHistory();
    board.setPlacements({ "": { "a.md": { x: 10, y: 20, w: 100, h: 50, z: 0 } } });
    close();

    board.undo();
    expect(board.doc.placements).toEqual({});

    board.redo();
    expect(board.doc.placements[""]?.["a.md"]?.x).toBe(10);
  });

  it("groups a gesture into one entry however many mutations it makes", () => {
    const board = store();
    const close = board.beginHistory();
    board.addObject(card("w1"));
    board.addObject(card("w2"));
    close();

    board.undo();
    expect(board.doc.objects).toHaveLength(0);
  });

  it("writes no entry for a gesture that changed nothing", () => {
    const board = store();
    board.addObject(card("w1"));
    board.beginHistory()();

    board.undo();
    expect(board.doc.objects).toHaveLength(0);
  });

  it("runs the attached filesystem action on undo, and again on redo", async () => {
    const board = store();
    const calls: string[] = [];

    const close = board.beginHistory();
    board.attachAction({
      revert: () => Promise.resolve(void calls.push("revert")),
      reapply: () => Promise.resolve(void calls.push("reapply")),
    });
    board.setPlacements({ "topic-x": { "a.md": { x: 1, y: 2, w: 10, h: 10, z: 0 } } });
    close();

    board.undo();
    board.redo();
    // The action is asynchronous by contract: the board restores itself at once
    // and the filesystem catches up.
    await Promise.resolve();

    expect(calls).toEqual(["revert", "reapply"]);
  });

  it("keeps an action's entry even when nothing on the board moved", () => {
    const board = store();
    let reverted = false;

    const close = board.beginHistory();
    board.attachAction({
      revert: () => Promise.resolve(void (reverted = true)),
      reapply: () => Promise.resolve(),
    });
    close();

    board.undo();
    expect(reverted).toBe(true);
  });

  it("drops the redo stack once a new change is made", () => {
    const board = store();
    board.addObject(card("w1"));
    board.undo();
    board.addObject(card("w2"));
    board.redo();

    expect(board.doc.objects.map((object) => object.id)).toEqual(["w2"]);
  });

  it("forgets its history when the board is closed", () => {
    const board = store();
    board.addObject(card("w1"));
    board.close();

    board.undo();
    expect(board.doc.objects.map((object) => object.id)).toEqual(["w1"]);
  });
});

describe("BoardStore vault routing", () => {
  it("sends a vault card's geometry to the placements hook, not the document", () => {
    const board = store();
    const patches: string[] = [];
    board.onVaultObjectPatch = (id) => void patches.push(id);
    board.vault = [
      {
        kind: "sticky",
        id: "a.md",
        path: "a.md",
        name: "a",
        title: null,
        preview: "",
        truncated: false,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        z: 0,
      },
    ];

    board.updateObject("a.md", { x: 40 });

    expect(patches).toEqual(["a.md"]);
    expect(board.doc.objects).toHaveLength(0);
  });

  it("reports a removed vault card as an unlink rather than deleting anything", () => {
    const board = store();
    const removed: string[][] = [];
    board.onVaultObjectsRemoved = (ids) => void removed.push(ids);
    board.vault = [
      {
        kind: "sticky",
        id: "a.md",
        path: "a.md",
        name: "a",
        title: null,
        preview: "",
        truncated: false,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        z: 0,
      },
    ];

    board.removeObjects(["a.md"]);

    expect(removed).toEqual([["a.md"]]);
  });
});
