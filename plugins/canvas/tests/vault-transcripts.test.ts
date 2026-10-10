/**
 * The board is for assets. A transcript lives in the vault because the host
 * writes it there, but the chat is read in its agent pane, never as a card.
 *
 * Tests compile Svelte for the server, where effects never run, so the
 * re-derive is asked for the way the board store asks for it.
 */

import { describe, expect, it } from "bun:test";
import { buildVaultIndex, toSnapshot, type VaultSource } from "@nib-ui/vault";
import { BoardStore } from "../src/board.svelte";
import { VaultStore } from "../src/vault.svelte";

const cwd = "/work/project";

/** A vault holding these files, each with an empty body. */
function vaultOf(...paths: string[]): VaultStore["doc"] {
  const source: VaultSource = {
    entries: paths.map((path) => ({ path, kind: "file" as const })),
    bodies: new Map(paths.map((path) => [path, ""])),
  };
  return { ...toSnapshot(buildVaultIndex(source)), cwd, writable: true, reason: null };
}

describe("transcripts on the board", () => {
  it("draws no card for a transcript, and every asset beside it", () => {
    const board = new BoardStore();
    board.doc = { version: 1, rev: 0, cwd, objects: [], placements: { "": {} }, stacks: {} };
    const vault = new VaultStore(board);
    vault.doc = vaultOf("root.jsonl", "child.jsonl", "notes.md", "photo.png");
    board.onBoardSynced?.();

    expect(board.vault.map((card) => card.path).sort()).toEqual(["notes.md", "photo.png"]);
  });
});
