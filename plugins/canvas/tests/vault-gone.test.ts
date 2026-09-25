/**
 * What happens to a path that leaves the vault, however it left — a card deleted
 * here, or an `rm` an agent ran.
 *
 * Two things have to follow it. Whatever was showing it is told, because a pane
 * open on a note with no file behind it is a window onto nothing and its unsaved
 * buffer would write the file back. And the url a card loads from changes, because
 * every cache in front of the route — Pixi's texture cache above all — is keyed by
 * that url, so a new `photo.png` at a deleted `photo.png` was fetched as the old one.
 */

import { describe, expect, it } from "bun:test";
import type { VaultDoc, VaultSnapshotItem } from "@nib-ui/vault";
import { BoardStore } from "../src/board.svelte";
import { VaultStore } from "../src/vault.svelte";

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  // An item with no slash in its path is at the vault root, whose directory is "".
  if (slash === -1) return "";
  return path.slice(0, slash);
}

function item(path: string): VaultSnapshotItem {
  return {
    path,
    kind: "file",
    dir: directoryOf(path),
    name: path.slice(path.lastIndexOf("/") + 1),
    id: null,
    title: null,
    color: null,
    preview: "",
    truncated: false,
    links: [],
  };
}

function doc(paths: string[]): VaultDoc {
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

/** A store whose scans are handed in, one `refresh` at a time. */
function vault(scans: VaultDoc[]): { store: VaultStore; gone: string[][] } {
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
  const queued = [...scans];
  store.transport = {
    loadVault: () => Promise.resolve(queued.shift() ?? doc([])),
  } as never;

  const gone: string[][] = [];
  store.onPathsGone = (paths) => gone.push([...paths]);
  return { store, gone };
}

describe("a path leaving the vault", () => {
  it("is reported once, with everything that went with it", async () => {
    const { store, gone } = vault([
      doc(["a.md", "topic", "topic/b.md"]),
      doc(["a.md"]),
      doc(["a.md"]),
    ]);

    await store.refresh();
    expect(gone).toEqual([]);

    await store.refresh();
    expect(gone).toEqual([["topic", "topic/b.md"]]);

    // Nothing has gone since, so nothing is reported again.
    await store.refresh();
    expect(gone).toEqual([["topic", "topic/b.md"]]);
  });

  it("is not reported for a scan that arrived before anything was known", async () => {
    const { store, gone } = vault([doc(["a.md"])]);

    await store.refresh();

    expect(gone).toEqual([]);
  });

  it("changes the url a file at that path loads from", async () => {
    const { store } = vault([doc(["photo.png"]), doc([]), doc(["photo.png"])]);

    await store.refresh();
    const first = store.fileUrl("photo.png");

    await store.refresh();
    await store.refresh();
    const second = store.fileUrl("photo.png");

    expect(first).not.toContain("v=");
    expect(second).not.toBe(first);
    expect(second).toContain("v=1");
  });
});
