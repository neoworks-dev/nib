/**
 * Renaming a folder from its card. The folder's placement, the board inside it
 * and the boards nested in that are all stored by path, so all of them have to
 * follow the new name, and one undo has to bring every one of them back.
 */

import { describe, expect, it } from "bun:test";
import type { VaultDoc, VaultSnapshotItem } from "@nib-ui/vault";
import { BoardStore } from "../src/board.svelte";
import { VaultStore } from "../src/vault.svelte";

function item(path: string): VaultSnapshotItem {
  let dir = "";
  if (path.includes("/")) dir = path.slice(0, path.lastIndexOf("/"));
  return {
    path,
    kind: path.includes(".") ? "file" : "topic",
    dir,
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

/** A path under `from`, or `from` itself, moved under `to`. */
function rebase(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  return path;
}

/** A store over an in-memory vault whose rename moves every path under the entry. */
async function opened(paths: string[]): Promise<{ board: BoardStore; store: VaultStore }> {
  const board = new BoardStore();
  board.doc = { version: 1, rev: 0, cwd: "/work/project", objects: [], placements: {}, stacks: {} };
  const store = new VaultStore(board);
  let present = [...paths];

  store.transport = {
    loadVault: () => Promise.resolve(doc(present)),
    renameVaultEntry: (_cwd: string, from: string, name: string) => {
      const slash = from.lastIndexOf("/");
      let to = name;
      if (slash !== -1) to = `${from.slice(0, slash)}/${name}`;
      present = present.map((path) => rebase(path, from, to));
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

describe("renaming a folder", () => {
  it("keeps the card where it was, under its new name", async () => {
    const { board, store } = await opened(["notes", "notes/a.md"]);
    board.updateObject("notes", { x: 700, y: 300 });

    const renamed = await store.renameEntry("notes", "journal");

    expect(renamed).toBe("journal");
    expect(board.doc.placements[""]?.["journal"]).toMatchObject({ x: 700, y: 300 });
    expect(board.doc.placements[""]?.["notes"]).toBeUndefined();
  });

  it("carries the boards inside it and nested in it", async () => {
    const { board, store } = await opened(["notes", "notes/a.md", "notes/deep", "notes/deep/b.md"]);
    const inner = { x: 10, y: 20, w: 100, h: 100, z: 1 };
    board.setPlacements({
      ...board.doc.placements,
      notes: { "notes/a.md": inner },
      "notes/deep": { "notes/deep/b.md": inner },
    });

    await store.renameEntry("notes", "journal");

    expect(board.doc.placements["journal"]).toEqual({ "journal/a.md": inner });
    expect(board.doc.placements["journal/deep"]).toEqual({ "journal/deep/b.md": inner });
    expect(board.doc.placements["notes"]).toBeUndefined();
  });

  it("keeps an open folder open", async () => {
    const { store } = await opened(["notes", "notes/a.md"]);
    store.togglePreview("notes");

    await store.renameEntry("notes", "journal");

    expect(store.preview).toBe("journal");
  });

  it("does nothing for an empty name", async () => {
    const { store } = await opened(["notes"]);

    expect(await store.renameEntry("notes", "   ")).toBeNull();
  });

  it("is undone in one step, placement and all", async () => {
    const { board, store } = await opened(["notes", "notes/a.md"]);
    board.updateObject("notes", { x: 700, y: 300 });
    const before = board.doc.placements[""]?.["notes"];

    await store.renameEntry("notes", "journal");
    board.undo();
    await settled();

    expect(board.doc.placements[""]?.["notes"]).toEqual(before);
    expect(board.doc.placements[""]?.["journal"]).toBeUndefined();
    expect(board.objects.some((object) => object.id === "notes")).toBe(true);
  });
});
