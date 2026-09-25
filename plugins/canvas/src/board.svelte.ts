import type { Disposer } from "@nib-ui/kernel";
import {
  type BoardDoc,
  type CanvasObject,
  emptyBoard,
  type PaneLayout,
  type TransportService,
} from "@nib-ui/ui-contracts";
import type { PlacementMap, StackMap } from "@nib-ui/vault";
import * as ops from "./board-ops";
import type { BoardObject } from "./board-view";

export const SAVE_DEBOUNCE_MS = 500;
const HISTORY_LIMIT = 100;

/**
 * One undoable state of the board: the authored objects and where the vault's
 * items sit. Placements are part of it because dragging a vault card is a board
 * change like any other, and because a move that reaches the filesystem has to
 * put the card back where it was in the same step (PLAN §13).
 */
export interface BoardSnapshot {
  objects: CanvasObject[];
  placements: PlacementMap;
  /** Where the piles sit. Undoing a collapse has to put the board back, not just the cards. */
  stacks: StackMap;
}

/**
 * What `mv` looks like to the undo stack. The board restores its own state
 * itself; these two only have to reverse and replay whatever happened on disk.
 */
export interface BoardAction {
  revert(): Promise<void>;
  reapply(): Promise<void>;
}

interface HistoryEntry extends BoardSnapshot {
  action?: BoardAction;
}

/**
 * The board for one working directory: the objects, their persistence, and the
 * undo stack over them. Camera and selection are per-window and live in the
 * registry, not here.
 */
export class BoardStore {
  transport = $state<TransportService | null>(null);
  doc = $state<BoardDoc>(emptyBoard(""));
  /**
   * Cards the vault contributes: this directory's items and its topics. Derived,
   * never stored — the board document remembers only where they sit.
   */
  vault = $state<BoardObject[]>([]);
  /** False until the server's board for the current directory has arrived. */
  loaded = $state(false);

  /** Set by the app: a vault card was moved or resized, so its placement moved. */
  onVaultObjectPatch: ((id: string, patch: Partial<CanvasObject>) => void) | null = null;
  /** Set by the app: a vault card was taken off this board. Nothing is deleted. */
  onVaultObjectsRemoved: ((ids: string[]) => void) | null = null;
  /** Set by the app: the document changed under the vault, so it has to re-derive. */
  onBoardSynced: (() => void) | null = null;
  /** Revision the server has confirmed; a write is `confirmedRev + 1`. */
  private confirmedRev = 0;
  private removedSinceConfirm: string[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private pending = false;
  private stream: Disposer | null = null;
  private opening: { cwd: string; done: Promise<void> } | null = null;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private historyDepth = 0;
  private historyBase: BoardSnapshot | null = null;
  private historyAction: BoardAction | null = null;

  private merged: {
    authored: CanvasObject[];
    vault: BoardObject[];
    result: CanvasObject[];
  } | null = null;

  /**
   * Authored cards first, then whatever the vault adds. Memoised on the identity of
   * both lists because the engine reads this every frame, and a fresh array per
   * frame is an allocation per frame.
   */
  get objects(): CanvasObject[] {
    const authored = this.doc.objects;
    const vault = this.vault;
    const cached = this.merged;
    if (cached && cached.authored === authored && cached.vault === vault) return cached.result;

    const result = vault.length === 0 ? authored : [...authored, ...vault];
    this.merged = { authored, vault, result };
    return result;
  }

  get cwd(): string {
    return this.doc.cwd;
  }

  get layout(): PaneLayout | undefined {
    return this.doc.layout;
  }

  /** Pane furniture, not board content: it is saved but never undone. */
  setLayout(layout: PaneLayout): void {
    const next = layout.docks.length > 0 ? layout : undefined;
    if (JSON.stringify(this.doc.layout ?? null) === JSON.stringify(next ?? null)) return;
    this.doc = { ...this.doc, layout: next };
    this.scheduleSave();
  }

  /**
   * Re-entrant on purpose: the caller is a reactive effect, and opening writes
   * `doc` before the load resolves. Without collapsing concurrent calls onto one
   * promise, every write would re-enter this and start the fetch again.
   */
  open(cwd: string): Promise<void> {
    if (this.opening?.cwd === cwd) return this.opening.done;
    if (this.doc.cwd === cwd && this.stream) return Promise.resolve();

    this.close();
    const transport = this.transport;
    this.doc = emptyBoard(cwd);
    this.confirmedRev = 0;
    if (!transport) return Promise.resolve();

    const done = transport
      .loadBoard(cwd)
      .then((loaded) => {
        // A board opened while this one was loading must not be overwritten by it.
        if (this.opening?.cwd !== cwd) return;
        this.doc = loaded;
        this.confirmedRev = loaded.rev;
        this.loaded = true;
        this.stream = transport.subscribeBoard(cwd, loaded.rev, (board) => this.applyRemote(board));
        this.onBoardSynced?.();
      })
      .finally(() => {
        if (this.opening?.cwd === cwd) this.opening = null;
      });

    this.opening = { cwd, done };
    return done;
  }

  close(): void {
    this.stream?.();
    this.stream = null;
    this.opening = null;
    this.loaded = false;
    this.vault = [];
    this.merged = null;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.pending = false;
    this.removedSinceConfirm = [];
    this.past = [];
    this.future = [];
    this.historyDepth = 0;
    this.historyBase = null;
    this.historyAction = null;
  }

  find(id: string): CanvasObject | null {
    const authored = this.doc.objects.find((object) => object.id === id);
    if (authored) return authored;
    return this.vault.find((object) => object.id === id) ?? null;
  }

  addObject(object: CanvasObject): void {
    const objects = ops.addObject(this.doc.objects, object);
    if (objects !== this.doc.objects) this.mutate(objects);
  }

  updateObject(id: string, patch: Partial<CanvasObject>): void {
    // A vault card's geometry is a placement, not a board write: dragging a note
    // must not copy the note into the board document.
    if (this.vault.some((object) => object.id === id)) {
      this.onVaultObjectPatch?.(id, patch);
      return;
    }
    const objects = ops.updateObject(this.doc.objects, id, patch);
    if (objects !== this.doc.objects) this.mutate(objects);
  }

  /**
   * Replaces the placements map. Writes only when it actually differs: the vault
   * re-derives after every scan and sync, and comparing stops that from being a
   * save each time.
   */
  setPlacements(placements: PlacementMap): void {
    if (JSON.stringify(this.doc.placements) === JSON.stringify(placements)) return;
    this.doc = { ...this.doc, placements };
    this.scheduleSave();
  }

  /** Where the piles sit. Written by the same rule as the placements. */
  setStacks(stacks: StackMap): void {
    if (JSON.stringify(this.doc.stacks) === JSON.stringify(stacks)) return;
    this.doc = { ...this.doc, stacks };
    this.scheduleSave();
  }

  removeObjects(ids: string[]): void {
    if (ids.length === 0) return;

    // A vault card stands for a file, so taking it off the board can only mean
    // unlinking it — and what that means is the app's call, not this store's.
    const vaultIds = this.vault.filter((object) => ids.includes(object.id)).map((o) => o.id);
    if (vaultIds.length > 0) this.onVaultObjectsRemoved?.(vaultIds);

    const authored = ids.filter((id) => !vaultIds.includes(id));
    if (authored.length === 0) return;
    this.removedSinceConfirm.push(...ops.withCascade(this.doc.objects, authored));
    this.mutate(ops.removeObjects(this.doc.objects, authored));
  }

  /**
   * Groups a gesture into one undo entry. Nested calls share the outermost
   * snapshot, so a tool that resizes inside a drag does not push two.
   */
  beginHistory(): Disposer {
    if (this.historyDepth === 0) this.historyBase = this.snapshot();
    this.historyDepth += 1;
    let closed = false;

    return () => {
      if (closed) return;
      closed = true;
      this.historyDepth -= 1;
      if (this.historyDepth > 0) return;
      const base = this.historyBase;
      const action = this.historyAction;
      this.historyBase = null;
      this.historyAction = null;
      if (!base) return;
      // An action always earns an entry: a `mv` that left every position where it
      // was is still a change to the filesystem, and still has to be undoable.
      if (action) return void this.pushHistory({ ...base, action });
      if (JSON.stringify(base) !== JSON.stringify(this.snapshot())) this.pushHistory(base);
    };
  }

  /**
   * Hangs a filesystem change off the open history scope, so the drag that caused
   * it, the `mv` and the positions it left behind are **one** undo step (PLAN §13).
   * Outside a scope it becomes an entry of its own, which is only right if nothing
   * has been mutated yet.
   */
  attachAction(action: BoardAction): void {
    if (this.historyDepth > 0) {
      this.historyAction = action;
      return;
    }
    this.pushHistory({ ...this.snapshot(), action });
  }

  /**
   * Optimistic: the board is restored at once and the filesystem catches up. A
   * reversal that fails leaves a card standing for a path the vault no longer has,
   * and the next scan drops it — which is the same self-healing every other stale
   * placement gets.
   */
  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    const action = previous.action;
    this.future.push({ ...this.snapshot(), action });
    this.restore(previous);
    if (action) void action.revert();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    const action = next.action;
    this.past.push({ ...this.snapshot(), action });
    this.restore(next);
    if (action) void action.reapply();
  }

  /** Waits out the debounce and any in-flight write — the tests' join point. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.save();
    }
    while (this.saving) await this.saving;
  }

  private mutate(objects: CanvasObject[]): void {
    // A gesture in progress owns the snapshot; a lone mutation is its own entry.
    if (this.historyDepth === 0) this.pushHistory(this.snapshot());
    this.doc = { ...this.doc, objects };
    this.scheduleSave();
  }

  /**
   * `structuredClone` cannot copy a Svelte state proxy, and the undo stack has to
   * hold values rather than live references into the board.
   */
  private snapshot(): BoardSnapshot {
    // One cast for the whole document rather than one per field: `$state.snapshot`
    // reports a deep-readonly type, and the three parts are taken off the same
    // copy so they cannot come from different instants either.
    const copied = $state.snapshot(this.doc) as BoardDoc;
    return { objects: copied.objects, placements: copied.placements, stacks: copied.stacks };
  }

  private restore(entry: BoardSnapshot): void {
    this.doc = {
      ...this.doc,
      objects: entry.objects,
      placements: entry.placements,
      stacks: entry.stacks,
    };
    this.scheduleSave();
    // The vault derives its cards from the placements it is handed back, so it has
    // to be told: nothing here is reactive on the document by design.
    this.onBoardSynced?.();
  }

  private pushHistory(entry: HistoryEntry): void {
    this.past.push(entry);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  private scheduleSave(): void {
    if (!this.transport || this.doc.cwd.length === 0) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  private async save(): Promise<void> {
    if (this.saving) {
      // A write is already in flight against this revision; queue behind it.
      this.pending = true;
      return;
    }

    const transport = this.transport;
    if (!transport) return;
    const cwd = this.doc.cwd;
    const objects = this.doc.objects;
    const layout = this.doc.layout;

    this.saving = (async () => {
      try {
        const stored = await transport.saveBoard({
          version: 1,
          rev: this.confirmedRev + 1,
          cwd,
          objects,
          placements: this.doc.placements,
          stacks: this.doc.stacks,
          layout,
        });
        if (this.doc.cwd !== cwd) return;
        this.confirmedRev = stored.rev;
        this.removedSinceConfirm = [];
        this.doc = { ...this.doc, rev: stored.rev };
      } catch {
        // Another window wrote first. Take its board as the base, keep what this
        // window changed on top, and let the retry carry the merge back.
        const server = await transport.loadBoard(cwd).catch(() => null);
        if (!server || this.doc.cwd !== cwd) return;
        this.confirmedRev = server.rev;
        this.doc = {
          ...server,
          objects: ops.rebaseObjects(server.objects, this.doc.objects, this.removedSinceConfirm),
          // The layout is where this window put its panes; another window's
          // board does not get to rearrange them under the user.
          layout: this.doc.layout ?? server.layout,
        };
        this.pending = true;
      }
    })().finally(() => {
      this.saving = null;
      if (!this.pending) return;
      this.pending = false;
      this.scheduleSave();
    });

    await this.saving;
  }

  /**
   * A board pushed by the server. Its own writes come back too, and are dropped
   * by revision; a newer one from another window is rebased over whatever this
   * window has not saved yet.
   */
  private applyRemote(board: BoardDoc): void {
    if (board.cwd !== this.doc.cwd || board.rev <= this.confirmedRev) return;
    this.confirmedRev = board.rev;

    // The layout is this window's own view of the workspace: it is taken from the
    // board when one is opened, and after that only written, never pushed back.
    const layout = this.doc.layout ?? board.layout;

    if (this.saveTimer || this.saving) {
      this.doc = {
        ...board,
        objects: ops.rebaseObjects(board.objects, this.doc.objects, this.removedSinceConfirm),
        layout,
      };
      this.scheduleSave();
      return;
    }
    this.removedSinceConfirm = [];
    this.doc = { ...board, layout };
    this.onBoardSynced?.();
  }
}
