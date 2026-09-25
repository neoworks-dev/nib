/**
 * Picking a card up out of something that was laid open. A folder's contents and
 * a spread pile both cover the board they sit on, so the drag would otherwise
 * cross a table that hides where the card can land.
 *
 * Tests compile Svelte for the server, where effects never run, so the re-derive
 * is asked for the way the board store asks for it.
 */

import { describe, expect, it } from "bun:test";
import { buildVaultIndex, toSnapshot, type VaultSource } from "@nib-ui/vault";
import type { BoardObject } from "../src/board-view";
import { BoardStore } from "../src/board.svelte";
import { VaultStore } from "../src/vault.svelte";

const cwd = "/work/project";

function store(files: Record<string, string>): {
  board: BoardStore;
  vault: VaultStore;
  redraw: () => void;
} {
  const topics = new Set(
    Object.keys(files)
      .filter((path) => path.includes("/"))
      .map((path) => path.slice(0, path.lastIndexOf("/"))),
  );
  const source: VaultSource = {
    entries: [
      ...[...topics].map((path) => ({ path, kind: "topic" as const })),
      ...Object.keys(files).map((path) => ({ path, kind: "file" as const })),
    ],
    bodies: new Map(Object.entries(files)),
  };
  const board = new BoardStore();
  board.doc = { version: 1, rev: 0, cwd, objects: [], placements: { "": {} }, stacks: {} };
  const vault = new VaultStore(board);
  vault.doc = { ...toSnapshot(buildVaultIndex(source)), cwd, writable: true, reason: null };
  return { board, vault, redraw: () => board.onBoardSynced?.() };
}

function cardAt(board: BoardStore, path: string): BoardObject | undefined {
  return board.vault.find((card) => card.path === path);
}

describe("dragging a card out of an opened folder", () => {
  it("closes the folder and leaves the card where it was picked up", () => {
    const { board, vault, redraw } = store({ "topic-x/a.md": "note", "topic-x/b.md": "note" });
    redraw();
    vault.togglePreview("topic-x");

    const picked = cardAt(board, "topic-x/a.md");
    expect(picked).toBeDefined();
    expect(cardAt(board, "topic-x/b.md")).toBeDefined();
    if (!picked) throw new Error("the folder laid out nothing");

    vault.beginDrag([picked.id]);

    expect(vault.preview).toBeNull();
    // The rest of the block is back in the folder; the dragged card is not.
    expect(cardAt(board, "topic-x/b.md")).toBeUndefined();
    const dragged = cardAt(board, "topic-x/a.md");
    expect(dragged).toMatchObject({ x: picked.x, y: picked.y });
    // Placed on this board while its file is still in the topic, which is what
    // the drop then moves.
    expect(board.doc.placements[""]?.["topic-x/a.md"]).toMatchObject({ x: picked.x, y: picked.y });
  });

  it("puts a card back in the folder when the drag moved no file", () => {
    const { board, vault, redraw } = store({ "topic-x/a.md": "note" });
    redraw();
    vault.togglePreview("topic-x");

    const picked = cardAt(board, "topic-x/a.md");
    if (!picked) throw new Error("the folder laid out nothing");
    vault.beginDrag([picked.id]);
    // The drop was inside the topic the file already lived in, so nothing moved.
    vault.settleDrag([picked.id]);

    expect(board.doc.placements[""]?.["topic-x/a.md"]).toBeUndefined();
    expect(cardAt(board, "topic-x/a.md")).toBeUndefined();
  });

  it("leaves the folder open for a drag of something else on the board", () => {
    const { board, vault, redraw } = store({ "topic-x/a.md": "note", "loose.md": "note" });
    redraw();
    vault.togglePreview("topic-x");

    vault.beginDrag(["loose.md"]);

    expect(vault.preview).toBe("topic-x");
    expect(cardAt(board, "topic-x/a.md")).toBeDefined();
  });
});

describe("opening a pile and closing it again", () => {
  it("puts the pile back exactly where it was", () => {
    // Cards of three sizes: a spread block of those is not centred on its own
    // bounds, so a fold that reads the middle off them walks the pile away.
    const { board, vault, redraw } = store({ "a.md": "one", "b.png": "", "c.txt": "" });
    redraw();

    const stack = vault.collapseStack(["a.md", "b.png", "c.txt"]);
    if (stack === null) throw new Error("expected a pile");
    const rect = board.doc.stacks[stack];
    const folded = { ...board.doc.placements[""] };

    vault.openStack(stack);
    vault.closePreview();

    expect(board.doc.stacks[stack]).toEqual(rect);
    expect(board.doc.placements[""]).toEqual(folded);
  });

  it("opens and closes where the pile was dragged to, not where it was folded", () => {
    const { board, vault, redraw } = store({ "a.md": "one", "b.png": "", "c.txt": "" });
    redraw();

    const stack = vault.collapseStack(["a.md", "b.png", "c.txt"]);
    if (stack === null) throw new Error("expected a pile");

    // The pile dragged clear across the board: a drag writes placements and
    // nothing else, so the stored rectangle is left where the fold put it.
    for (const [path, placement] of Object.entries({ ...board.doc.placements[""] })) {
      board.updateObject(path, { x: placement.x + 400, y: placement.y + 250 });
    }
    const dragged = { ...board.doc.placements[""] };

    vault.openStack(stack);
    vault.closePreview();

    expect(board.doc.placements[""]).toEqual(dragged);
  });
});

describe("dragging a card out of a spread pile", () => {
  it("folds the pile back up and takes the card out of it", () => {
    const { board, vault, redraw } = store({ "a.md": "one", "b.md": "two", "c.md": "three" });
    redraw();

    const stack = vault.collapseStack(["a.md", "b.md", "c.md"]);
    expect(stack).not.toBeNull();
    if (stack === null) return;
    vault.openStack(stack);

    vault.beginDrag(["a.md"]);

    expect(vault.stackOf("a.md")).toBeNull();
    // The two left are a pile again, folded over each other rather than spread.
    expect(vault.stackOf("b.md")).toBe(stack);
    expect(vault.isOpen(stack)).toBe(false);
    expect(cardAt(board, "a.md")).toBeDefined();
  });
});
