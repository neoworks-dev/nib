import type { Disposer } from "@nib-ui/kernel";
import { type BoardDoc, emptyBoard } from "@nib-ui/ui-contracts";
import { buildVaultIndex, toSnapshot, type VaultEntry } from "@nib-ui/vault";
import { applyPlacements, type PlacementWrite } from "../src/lib/server/board-store";
import type { BoardService, VaultService } from "../src/lib/server/services";
import type { VaultOpenResult } from "../src/lib/server/vault";

/**
 * One project's board, held in memory. Placements go through the same merge the
 * real store uses, so a test of the canvas tools is a test of what lands on disk.
 */
export class FakeBoards implements BoardService {
  doc: BoardDoc;

  constructor(cwd: string) {
    this.doc = emptyBoard(cwd);
  }

  read(): Promise<BoardDoc> {
    return Promise.resolve(this.doc);
  }

  place(_cwd: string, writes: readonly PlacementWrite[]): Promise<BoardDoc> {
    this.doc = {
      ...this.doc,
      rev: this.doc.rev + 1,
      placements: applyPlacements(this.doc.placements, writes),
    };
    return Promise.resolve(this.doc);
  }

  list(): Promise<never> {
    throw new Error("the fake board store does not list");
  }

  write(): Promise<never> {
    throw new Error("the fake board store does not take whole boards");
  }

  reviewWorkstream(): Promise<never> {
    throw new Error("the fake board store has no workstreams");
  }

  subscribe(): Disposer {
    return () => {};
  }
}

/**
 * A vault of paths and nothing else. The snapshot is built by the real index, so
 * an item's `dir`, `name` and `title` are what a scan of those files would report.
 */
export class FakeVault implements VaultService {
  constructor(
    private readonly cwd: string,
    private readonly entries: readonly VaultEntry[],
    private readonly bodies: ReadonlyMap<string, string> = new Map(),
  ) {}

  open(): Promise<VaultOpenResult> {
    const index = buildVaultIndex({ entries: this.entries, bodies: this.bodies });
    return Promise.resolve({
      cwd: this.cwd,
      root: `${this.cwd}/.nib`,
      writable: true,
      reason: null,
      ...toSnapshot(index),
    });
  }

  readFile(): Promise<never> {
    throw new Error("the fake vault does not read files");
  }

  statFile(): Promise<never> {
    throw new Error("the fake vault does not stat files");
  }

  fileStream(): never {
    throw new Error("the fake vault does not stream files");
  }

  move(): Promise<never> {
    throw new Error("the fake vault does not move");
  }

  write(): Promise<never> {
    throw new Error("the fake vault does not write");
  }

  writeText(): Promise<never> {
    throw new Error("the fake vault does not write");
  }

  delete(): Promise<never> {
    throw new Error("the fake vault does not delete");
  }

  trash(): Promise<never> {
    throw new Error("the fake vault has no bin");
  }

  restoreTrash(): Promise<never> {
    throw new Error("the fake vault has no bin");
  }

  listTrash(): Promise<never> {
    throw new Error("the fake vault has no bin");
  }

  purgeTrash(): Promise<never> {
    throw new Error("the fake vault has no bin");
  }
}

/** The files a canvas test arranges: two notes at the root and one inside a topic. */
export function fakeVaultEntries(): VaultEntry[] {
  return [
    { path: "notes.md", kind: "file" },
    { path: "plan.md", kind: "file" },
    { path: "topic", kind: "topic" },
    { path: "topic/deep.md", kind: "file" },
  ];
}
