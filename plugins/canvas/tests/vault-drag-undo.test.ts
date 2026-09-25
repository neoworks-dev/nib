/**
 * Undoing what moved a card: a drag, and a delete.
 *
 * A placement only survives a reconcile if the vault still holds the item it
 * belongs to, and the board restores its snapshot *before* the filesystem catches
 * up — so undoing a delete has to write the position back itself, after the file
 * is out of the bin. Without that the note came back at a fresh flowed slot rather
 * than where it was deleted from.
 */

import { describe, expect, it } from "bun:test";
import type { Placement, TrashEntry, VaultDoc, VaultSnapshotItem } from "@nib-ui/vault";
import { BoardStore } from "../src/board.svelte";
import { VaultStore } from "../src/vault.svelte";

function item(path: string): VaultSnapshotItem {
  return {
    path,
    kind: path.includes(".") ? "file" : "topic",
    dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    name: path.slice(path.lastIndexOf("/") + 1),
    id: null,
    title: null,
    color: null,
    preview: "",
    truncated: false,
    links: [],
  };
}

function doc(paths: readonly string[]): VaultDoc {
  return {
    cwd: "/work/project",
    writable: true,
    reason: null,
    items: paths.map(item),
    links: [],
    backlinks: {},
    unresolved: [],
    mentions: [],
  };
}

/**
 * A store over a vault that really answers, so `derive` runs and the cards the
 * board draws are the ones under test. The bin is in memory: what is in it is out
 * of the vault, which is what makes the reconcile drop its placement.
 */
async function opened(paths: string[]): Promise<{ board: BoardStore; store: VaultStore }> {
  const board = new BoardStore();
  board.doc = {
    version: 1,
    rev: 0,
    cwd: "/work/project",
    objects: [],
    placements: {},
    stacks: {},
  };
  const store = new VaultStore(board);
  const present = new Set(paths);
  const binned = new Map<string, string>();

  store.transport = {
    loadVault: () => Promise.resolve(doc([...present])),
    trashVaultEntry: (_cwd: string, path: string): Promise<TrashEntry> => {
      present.delete(path);
      const id = `bin-${binned.size + 1}`;
      binned.set(id, path);
      return Promise.resolve({ id, path, name: path, kind: "file", deletedAt: 1 });
    },
    restoreTrashEntry: (_cwd: string, id: string): Promise<{ path: string }> => {
      const path = binned.get(id) ?? id;
      binned.delete(id);
      present.add(path);
      return Promise.resolve({ path });
    },
    moveVaultEntry: (
      _cwd: string,
      from: string,
      toDirectory: string,
    ): Promise<{ from: string; to: string; rewritten: string[] }> => {
      const name = from.slice(from.lastIndexOf("/") + 1);
      const to = toDirectory.length === 0 ? name : `${toDirectory}/${name}`;
      present.delete(from);
      present.add(to);
      return Promise.resolve({ from, to, rewritten: [] });
    },
  } as never;

  await store.refresh();
  return { board, store };
}

/** Undo starts the reversal without waiting for it; this is where it lands. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function placementOf(board: BoardStore, path: string): Placement | undefined {
  return board.doc.placements[""]?.[path];
}

describe("undoing a drag of a vault card", () => {
  it("puts the placement back", async () => {
    const { board } = await opened(["a.md"]);
    const before = placementOf(board, "a.md");
    expect(before).toBeDefined();

    const close = board.beginHistory();
    board.updateObject("a.md", { x: 900, y: 900 });
    close();
    expect(placementOf(board, "a.md")?.x).toBe(900);

    board.undo();

    expect(placementOf(board, "a.md")).toEqual(before);
  });
});

describe("undoing a delete", () => {
  it("brings the card back where it was, not at a flowed slot", async () => {
    const { board, store } = await opened(["a.md", "b.md"]);
    // Dragged somewhere of its own first, so a flowed slot is visibly not it.
    board.updateObject("a.md", { x: 900, y: 640 });
    const dragged = placementOf(board, "a.md");
    expect(dragged).toMatchObject({ x: 900, y: 640 });

    await store.deleteEntry("a.md");
    expect(placementOf(board, "a.md")).toBeUndefined();

    board.undo();
    await settled();

    expect(placementOf(board, "a.md")).toEqual(dragged);
    expect(board.objects.find((object) => object.id === "a.md")).toMatchObject({ x: 900, y: 640 });
  });

  it("does the same for a whole selection deleted at once", async () => {
    const { board, store } = await opened(["a.md", "b.md"]);
    board.updateObject("a.md", { x: 900, y: 640 });
    board.updateObject("b.md", { x: 1200, y: 80 });
    const places = { ...board.doc.placements[""] };

    await store.deleteEntries(["a.md", "b.md"]);
    board.undo();
    await settled();

    expect(board.doc.placements[""]).toEqual(places);
  });
});

describe("undoing a drop into a topic", () => {
  it("puts the card back where it was dragged from", async () => {
    const { board, store } = await opened(["a.md", "topic"]);
    board.updateObject("a.md", { x: 900, y: 640 });
    const dragged = placementOf(board, "a.md");

    await store.moveInto(["a.md"], "topic");
    expect(placementOf(board, "a.md")).toBeUndefined();

    board.undo();
    await settled();

    expect(placementOf(board, "a.md")).toEqual(dragged);
  });
});
