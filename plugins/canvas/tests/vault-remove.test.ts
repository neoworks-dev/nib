/**
 * What Delete does to a vault card. The two cases are not the same gesture: a
 * card placed here from elsewhere is unlinked, and one that is here because it
 * lives in this directory has nothing to unlink — dropping its placement used to
 * leave it on the board at a fresh flowed position, which read as the card
 * wandering off rather than being deleted.
 *
 * Deleting files the entry in the recycling bin and nothing is asked first: the
 * reversal is the guarantee, so ctrl+z has to put the file *and* its placement
 * back, which is what the undo tests here pin.
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { Placement, TrashEntry } from "@nib-ui/vault";
import type { BoardObject } from "../src/board-view";
import { BoardStore } from "../src/board.svelte";
import { VaultStore } from "../src/vault.svelte";

const trashed: string[] = [];
const restored: string[] = [];

function sticky(path: string): BoardObject {
  return {
    kind: "sticky",
    id: path,
    path,
    name: path,
    title: null,
    color: "green",
    preview: "",
    truncated: false,
    offset: 0,
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    z: 1,
  };
}

/**
 * The store with a transport that files and restores in memory. `loadVault`
 * refuses, so nothing re-derives and the placements are readable as the gesture
 * left them.
 */
function vault(
  cards: BoardObject[],
  placements: Record<string, Placement>,
  options: { restoreAs?: string } = {},
): { board: BoardStore; store: VaultStore } {
  const board = new BoardStore();
  board.doc = {
    version: 1,
    rev: 0,
    cwd: "/work/project",
    objects: [],
    placements: { "": placements },
    stacks: {},
  };
  board.vault = cards;
  const store = new VaultStore(board);
  const binned = new Map<string, string>();
  store.transport = {
    trashVaultEntry: (_cwd: string, path: string): Promise<TrashEntry> => {
      trashed.push(path);
      const id = `bin-${trashed.length}`;
      binned.set(id, path);
      return Promise.resolve({ id, path, name: path, kind: "file", deletedAt: 1 });
    },
    restoreTrashEntry: (_cwd: string, id: string): Promise<{ path: string }> => {
      restored.push(id);
      // A test may pin where the file comes back; otherwise it comes back as itself.
      if (options.restoreAs !== undefined) return Promise.resolve({ path: options.restoreAs });
      return Promise.resolve({ path: binned.get(id) ?? id });
    },
    loadVault: () => Promise.reject(new Error("no server")),
  } as never;
  return { board, store };
}

afterEach(() => {
  trashed.length = 0;
  restored.length = 0;
});

/** Undo starts the reversal without waiting for it; this is where it lands. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("removing a vault card from the board", () => {
  it("files a card that lives in this directory, asking nothing first", async () => {
    const { board, store } = vault([sticky("a.md")], {
      "a.md": { x: 0, y: 0, w: 200, h: 200, z: 1 },
    });

    await store.deleteEntry("a.md");

    expect(trashed).toEqual(["a.md"]);
    expect(board.doc.placements[""]?.["a.md"]).toBeUndefined();
  });

  it("unlinks a card placed here from elsewhere, without deleting anything", () => {
    const { board } = vault([sticky("topic/b.md")], {
      "topic/b.md": { x: 0, y: 0, w: 200, h: 200, z: 1 },
    });

    board.removeObjects(["topic/b.md"]);

    expect(trashed).toEqual([]);
    expect(board.doc.placements[""]?.["topic/b.md"]).toBeUndefined();
  });

  it("offers no unlink for a card that lives in this directory", () => {
    const { store } = vault([sticky("a.md")], { "a.md": { x: 0, y: 0, w: 200, h: 200, z: 1 } });

    expect(store.canUnlink("a.md")).toBe(false);
    expect(store.canUnlink("topic/b.md")).toBe(false);
  });
});

describe("undoing a delete", () => {
  it("restores the file and puts the placement back", async () => {
    const placement = { x: 40, y: 80, w: 200, h: 200, z: 1 };
    const { board, store } = vault([sticky("a.md")], { "a.md": placement });

    await store.deleteEntry("a.md");
    board.undo();
    await settled();

    expect(restored).toEqual(["bin-1"]);
    expect(board.doc.placements[""]?.["a.md"]).toEqual(placement);
  });

  it("follows the file to the name it came back under", async () => {
    const placement = { x: 40, y: 80, w: 200, h: 200, z: 1 };
    const { board, store } = vault(
      [sticky("a.md")],
      { "a.md": placement },
      { restoreAs: "a-1.md" },
    );

    await store.deleteEntry("a.md");
    board.undo();
    // The action runs after the board has restored its own snapshot, so the write
    // it makes lands on top of it.
    await settled();

    expect(board.doc.placements[""]?.["a-1.md"]).toEqual(placement);
  });

  it("is one step for a selection deleted together", async () => {
    const { board, store } = vault([sticky("a.md"), sticky("b.md")], {
      "a.md": { x: 0, y: 0, w: 200, h: 200, z: 1 },
      "b.md": { x: 8, y: 8, w: 200, h: 200, z: 1 },
    });

    await store.deleteEntries(["a.md", "b.md"]);
    board.undo();
    await settled();

    // Reversed, so a batch unwinds in the order it was made.
    expect(trashed).toEqual(["a.md", "b.md"]);
    expect(restored).toEqual(["bin-2", "bin-1"]);
    expect(board.doc.placements[""]).toEqual({
      "a.md": { x: 0, y: 0, w: 200, h: 200, z: 1 },
      "b.md": { x: 8, y: 8, w: 200, h: 200, z: 1 },
    });
  });
});
