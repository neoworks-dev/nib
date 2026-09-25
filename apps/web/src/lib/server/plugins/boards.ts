import type { Disposer, Plugin } from "@nib-ui/kernel";
import type { BoardDoc, BoardSummary, BoardWrite, CanvasObject } from "@nib-ui/ui-contracts";
import {
  applyPlacements,
  boardSummary,
  listBoardFiles,
  type PlacementWrite,
  readBoardFile,
  withObjects,
  writeBoardFile,
} from "../board-store";
import { boardsDirectory } from "../data-dir";
import type { BoardService } from "../services";

type BoardListener = (board: BoardDoc) => void;

class BoardStore implements BoardService {
  private readonly listeners = new Map<string, Set<BoardListener>>();
  /** Per-directory write chain: the `rev` check is read-then-write, so it cannot interleave. */
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(private readonly directory: string) {}

  read(cwd: string): Promise<BoardDoc> {
    return readBoardFile(this.directory, cwd);
  }

  async list(): Promise<BoardSummary[]> {
    return (await listBoardFiles(this.directory)).map(boardSummary);
  }

  write(board: BoardWrite): Promise<BoardDoc> {
    return this.chain(board.cwd, () => writeBoardFile(this.directory, board));
  }

  /**
   * Moves cards without a window being open on the board. One chain link and one
   * revision for the whole arrangement, so every open window redraws it at once
   * rather than watching the cards move one by one.
   */
  place(cwd: string, writes: readonly PlacementWrite[]): Promise<BoardDoc> {
    return this.chain(cwd, async () => {
      const board = await readBoardFile(this.directory, cwd);
      return writeBoardFile(this.directory, {
        ...board,
        rev: board.rev + 1,
        placements: applyPlacements(board.placements, writes),
      });
    });
  }

  /**
   * Adds authored objects without a window being open on the board — a link a
   * ComfyUI run leaves between a picture and what it made of it.
   */
  addObjects(cwd: string, objects: readonly CanvasObject[]): Promise<BoardDoc> {
    return this.chain(cwd, async () => {
      const board = await readBoardFile(this.directory, cwd);
      return writeBoardFile(this.directory, {
        ...board,
        rev: board.rev + 1,
        objects: withObjects(board.objects, objects),
      });
    });
  }

  /**
   * Marks a workstream read without the board being open anywhere. The read and
   * the write sit in one chain link, so the revision this bumps is the one it
   * just read rather than whatever a concurrent window wrote in between.
   */
  reviewWorkstream(cwd: string, workstreamId: string, reviewed: boolean): Promise<BoardDoc> {
    return this.chain(cwd, async () => {
      const board = await readBoardFile(this.directory, cwd);
      let found = false;
      const objects = board.objects.map((object) => {
        if (object.id !== workstreamId || object.kind !== "workstream") return object;
        found = true;
        const { reviewedAt: _dropped, ...rest } = object as CanvasObject & { reviewedAt?: unknown };
        return reviewed ? { ...rest, reviewedAt: Date.now() } : rest;
      });
      if (!found) throw new Error(`board "${cwd}" has no workstream "${workstreamId}"`);
      return writeBoardFile(this.directory, { ...board, rev: board.rev + 1, objects });
    });
  }

  subscribe(cwd: string, listener: BoardListener): Disposer {
    const set = this.listeners.get(cwd) ?? new Set<BoardListener>();
    set.add(listener);
    this.listeners.set(cwd, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(cwd);
    };
  }

  private chain(cwd: string, task: () => Promise<BoardDoc>): Promise<BoardDoc> {
    const pending = (this.writes.get(cwd) ?? Promise.resolve()).then(task, task);
    this.writes.set(
      cwd,
      pending.catch(() => undefined),
    );
    return pending.then((stored) => {
      for (const listener of [...(this.listeners.get(cwd) ?? [])]) listener(stored);
      return stored;
    });
  }
}

export const boardsPlugin: Plugin = {
  name: "boards",
  apply(ctx) {
    ctx.provide("boards", new BoardStore(boardsDirectory()));
  },
};
