/**
 * A spawned agent's transcript is folded into its spawner's card: the chat is
 * read through that card's tabs, so a card of its own would be the same
 * conversation twice on the board.
 *
 * Tests compile Svelte for the server, where effects never run, so the
 * re-derive is asked for the way the board store asks for it; the effect that
 * asks on a lineage change is not exercised here.
 */

import { describe, expect, it } from "bun:test";
import type { SessionsService, SessionSummary } from "@nib-ui/ui-contracts";
import { buildVaultIndex, toSnapshot, type VaultSource } from "@nib-ui/vault";
import { BoardStore } from "../src/board.svelte";
import { VaultStore } from "../src/vault.svelte";

const cwd = "/work/project";

function transcripts(...sessionIds: string[]): VaultStore["doc"] {
  const source: VaultSource = {
    entries: sessionIds.map((id) => ({ path: `${id}.jsonl`, kind: "file" as const })),
    bodies: new Map(sessionIds.map((id) => [`${id}.jsonl`, ""])),
  };
  return { ...toSnapshot(buildVaultIndex(source)), cwd, writable: true, reason: null };
}

function sessions(lineage: Record<string, string | null>): SessionsService {
  const summaries = Object.entries(lineage).map(
    ([id, parentSessionId]) => ({ id, parentSessionId }) as SessionSummary,
  );
  return { summaries } as SessionsService;
}

function store(): { board: BoardStore; vault: VaultStore; redraw: () => void } {
  const board = new BoardStore();
  board.doc = { version: 1, rev: 0, cwd, objects: [], placements: { "": {} }, stacks: {} };
  const vault = new VaultStore(board);
  vault.doc = transcripts("root", "child");
  return { board, vault, redraw: () => board.onBoardSynced?.() };
}

describe("folding spawned agents into their spawner's card", () => {
  it("draws a spawned agent's transcript on no card of its own", () => {
    const { board, vault, redraw } = store();
    vault.sessions = sessions({ root: null, child: "root" });
    redraw();

    expect(board.vault.map((card) => card.path)).toEqual(["root.jsonl"]);
  });

  it("draws every transcript while nothing says who spawned whom", () => {
    const { board, vault, redraw } = store();
    vault.sessions = sessions({ root: null, child: null });
    redraw();

    expect(board.vault.map((card) => card.path)).toEqual(["child.jsonl", "root.jsonl"]);
  });

  it("folds a card away once the session list learns it was spawned", () => {
    const { board, vault, redraw } = store();
    vault.sessions = sessions({ root: null, child: null });
    redraw();
    expect(board.vault).toHaveLength(2);

    vault.sessions = sessions({ root: null, child: "root" });
    redraw();
    expect(board.vault.map((card) => card.path)).toEqual(["root.jsonl"]);
  });
});
