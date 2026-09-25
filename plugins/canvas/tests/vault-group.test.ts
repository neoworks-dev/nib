/**
 * Putting a selection into a topic of its own. The directory is made by the move
 * itself — `mv` into a path that is not there creates it — so what this pins is
 * everything around that: the name nothing else holds, the topic's card landing
 * where the cards were, and an undo that takes the empty directory back out with
 * the files rather than leaving a folder nobody asked for on the board.
 */

import { describe, expect, it } from "bun:test";
import type { Placement } from "@nib-ui/vault";
import { buildVaultIndex, toSnapshot, type VaultSource } from "@nib-ui/vault";
import { FOLDER_SIZE } from "../src/board-view";
import { BoardStore } from "../src/board.svelte";
import { VaultStore } from "../src/vault.svelte";

const cwd = "/work/project";

/** The vault as the scan would report it: the files, plus a topic per directory. */
function snapshot(paths: readonly string[]): VaultStore["doc"] {
  const topics = new Set<string>();
  for (const path of paths) {
    const slash = path.lastIndexOf("/");
    if (slash > 0) topics.add(path.slice(0, slash));
  }
  const source: VaultSource = {
    entries: [
      ...[...topics].map((path) => ({ path, kind: "topic" as const })),
      ...paths.map((path) => ({ path, kind: "file" as const })),
    ],
    bodies: new Map(paths.map((path) => [path, ""])),
  };
  return { ...toSnapshot(buildVaultIndex(source)), cwd, writable: true, reason: null };
}

interface Harness {
  board: BoardStore;
  vault: VaultStore;
  /** Every move the gesture asked for, as `from` and the directory it named. */
  moved: { from: string; to: string }[];
  deleted: string[];
}

/** A vault the moves actually land in, so the scan after one answers with the new paths. */
function store(paths: readonly string[], placements: Record<string, Placement>): Harness {
  const board = new BoardStore();
  board.doc = { version: 1, rev: 0, cwd, objects: [], placements: { "": placements }, stacks: {} };
  const vault = new VaultStore(board);
  const held = new Set(paths);
  const moved: { from: string; to: string }[] = [];
  const deleted: string[] = [];
  vault.transport = {
    moveVaultEntry: (_cwd: string, from: string, toDirectory: string) => {
      moved.push({ from, to: toDirectory });
      const name = from.slice(from.lastIndexOf("/") + 1);
      const to = toDirectory.length === 0 ? name : `${toDirectory}/${name}`;
      held.delete(from);
      held.add(to);
      return Promise.resolve({ from, to, rewritten: [] });
    },
    deleteVaultEntry: (_cwd: string, path: string) => {
      deleted.push(path);
      return Promise.resolve();
    },
    loadVault: () => Promise.resolve(snapshot([...held])),
  } as never;
  vault.doc = snapshot([...held]);
  board.onBoardSynced?.();
  return { board, vault, moved, deleted };
}

/** Undo starts the reversal without waiting for it; this is where it lands. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("putting a selection into a topic", () => {
  it("moves every card into one new directory and places its card where they were", async () => {
    const { board, vault, moved } = store(["a.md", "b.md"], {
      "a.md": { x: 0, y: 0, w: 200, h: 100, z: 1 },
      "b.md": { x: 400, y: 200, w: 200, h: 100, z: 2 },
    });

    const topic = await vault.groupIntoTopic(["a.md", "b.md"]);

    expect(topic).toBe("New topic");
    expect(moved).toEqual([
      { from: "a.md", to: "New topic" },
      { from: "b.md", to: "New topic" },
    ]);
    // Centred on what the two covered: 0..600 across, 0..300 down.
    expect(board.doc.placements[""]?.["New topic"]).toEqual({
      x: 300 - FOLDER_SIZE.w / 2,
      y: 150 - FOLDER_SIZE.h / 2,
      ...FOLDER_SIZE,
      z: 1,
    });
  });

  it("does not land in a topic that is already there", async () => {
    const { vault, moved } = store(["New topic/kept.md", "a.md"], {
      "a.md": { x: 0, y: 0, w: 200, h: 100, z: 1 },
    });

    await vault.groupIntoTopic(["a.md"]);

    expect(moved).toEqual([{ from: "a.md", to: "New topic 2" }]);
  });

  it("takes the empty topic back out on undo", async () => {
    const placement = { x: 40, y: 80, w: 200, h: 100, z: 1 };
    const { board, vault, moved, deleted } = store(["a.md"], { "a.md": placement });

    await vault.groupIntoTopic(["a.md"]);
    board.undo();
    await settled();

    expect(moved.at(-1)).toEqual({ from: "New topic/a.md", to: "" });
    expect(deleted).toEqual(["New topic"]);
    expect(board.doc.placements[""]?.["a.md"]).toEqual(placement);
  });
});
