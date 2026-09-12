/**
 * The window's view of the vault: which board it is on, what that board holds, and
 * what is being previewed.
 *
 * The board document is the only place a position is written, and this store is the
 * only thing that writes it. Deriving is explicit rather than reactive on purpose:
 * a computation that writes board state is the loop `NEXT.md` §9 warns about, so
 * every path into `derive` is a user action or a sync the board told us about.
 */

import type { Disposer } from "@nib-ui/kernel";
import type { CanvasObject, Point, TransportService, VaultMoveResult } from "@nib-ui/ui-contracts";
import type { Placement, VaultDoc, VaultSnapshotItem } from "@nib-ui/vault";
import type { BoardStore } from "./board.svelte";
import {
  type BoardObject,
  type FileObject,
  TOPIC_SIZE,
  boardView,
  type LinkSummary,
  linkSummary,
  previewObjects,
  type TopicObject,
} from "./board-view";

/** World units between a topic card and the block of its contents. */
const PREVIEW_GAP = 24;
/** How wide a previewed block of contents is allowed to get. */
const PREVIEW_WIDTH = 720;

const CARD_SIZE: { w: number; h: number } = { w: 288, h: 132 };
const MEDIA_SIZE: { w: number; h: number } = { w: 340, h: 230 };

/** What the editor can usefully show. Everything else the browser is better at. */
const TEXT_EXTENSIONS = new Set([
  "",
  "md",
  "markdown",
  "txt",
  "json",
  "jsonl",
  "csv",
  "yaml",
  "yml",
  "toml",
  "ts",
  "tsx",
  "js",
  "jsx",
  "svelte",
  "css",
  "html",
  "xml",
  "sh",
  "py",
  "rs",
  "go",
  "log",
]);

const MEDIA_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "pdf",
  "mp4",
  "webm",
]);

export class VaultStore {
  transport = $state<TransportService | null>(null);
  /** The vault as the server last reported it. Null until the first load resolves. */
  doc = $state<VaultDoc | null>(null);

  /** The directory this board shows. `""` is the vault root. */
  view = $state("");
  /** Directories walked down from the root, so going up is one step. */
  trail = $state<string[]>([]);
  /** The topic whose contents are on screen beside it, if any. */
  preview = $state<string | null>(null);

  loading = $state(false);
  error = $state<string | null>(null);

  /**
   * Set by the app: reading a note is the editor's business. It answers false when
   * there is no editor loaded, and the browser gets the file instead.
   */
  openNote: ((cwd: string, path: string) => boolean) | null = null;

  /** This board's own cards, positioned by the placements map. */
  private cards: BoardObject[] = [];
  /** The previewed topic's contents, laid out by the app and never persisted. */
  private contents: BoardObject[] = [];
  /** The filesystem watch for the open project, so a model's write shows up. */
  private stream: Disposer | null = null;
  /** The project `stream` is watching, so re-opening the same one is a no-op. */
  private watched: string | null = null;

  constructor(private readonly board: BoardStore) {
    board.onVaultObjectPatch = (id, patch) => this.patchCard(id, patch);
    board.onVaultObjectsRemoved = (ids) => this.unlink(ids);
    board.onBoardSynced = () => this.derive();
  }

  get cwd(): string {
    return this.board.cwd;
  }

  get canGoUp(): boolean {
    return this.view.length > 0;
  }

  get root(): string {
    return this.trail[0] ?? "";
  }

  /** The topic currently entered, or null at the root. */
  get topic(): string | null {
    return this.view.length === 0 ? null : this.view;
  }

  /**
   * A project was opened. Only a *different* project resets where the window was
   * looking: switching sessions inside one project must not throw the topic the
   * user is standing in away, and the vault itself is re-read either way.
   */
  async load(): Promise<void> {
    if (this.doc === null || this.doc.cwd !== this.board.cwd) this.forget();
    this.watch();
    await this.refresh();
  }

  /** Drops the watch. The store survives; what it was watching does not. */
  close(): void {
    this.stream?.();
    this.stream = null;
    this.watched = null;
  }

  /**
   * A file the model writes mid-session has to appear without a reload, and the
   * server says only that something changed: the scan is this side's, so there is
   * one way to read the vault rather than two.
   *
   * Idempotent per project: switching between two sessions of one project re-runs
   * `load`, and tearing the stream down and back up each time would drop events
   * in the gap.
   */
  private watch(): void {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (this.watched === cwd) return;

    this.close();
    if (!transport || cwd.length === 0) return;
    this.watched = cwd;
    this.stream = transport.subscribeVault(cwd, () => void this.refresh());
  }

  /** Back to the root board with the vault dropped, so no board can draw a stale one. */
  private forget(): void {
    this.view = "";
    this.trail = [];
    this.preview = null;
    this.doc = null;
    this.error = null;
    this.cards = [];
    this.contents = [];
    this.publish();
  }

  /** Re-reads the vault off disk. The whole point is that disk is the truth. */
  async refresh(): Promise<void> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0) return;

    this.loading = true;
    try {
      // Mentions are quadratic over the vault's items and the links panel is the
      // only reader, but a project's vault is one project's notes and the scan
      // already walked every one of them.
      const doc = await transport.loadVault(cwd, { mentions: true });
      // Another project took the board while this was loading.
      if (this.board.cwd !== cwd) return;
      this.doc = doc;
      this.error = null;
      this.derive();
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      this.loading = false;
    }
  }

  /** Enters a topic: its board replaces the canvas. */
  enter(topic: TopicObject | string): void {
    const path = typeof topic === "string" ? topic : topic.path;
    if (path.length === 0 || path === this.view) return;
    this.trail = [...this.trail, this.view];
    this.view = path;
    this.preview = null;
    this.derive();
  }

  /** Back one step, to the directory this one sits in. */
  up(): void {
    if (!this.canGoUp) return;
    const trail = [...this.trail];
    const parent = trail.pop();
    this.trail = trail;
    this.view = parent ?? "";
    this.preview = null;
    this.derive();
  }

  /** All the way out, to the vault root board. */
  toRoot(): void {
    if (!this.canGoUp) return;
    this.trail = [];
    this.view = "";
    this.preview = null;
    this.derive();
  }

  /** Where the window is, root first: what a breadcrumb draws. */
  get breadcrumb(): string[] {
    return [...this.trail, this.view];
  }

  /** Jumps back to an ancestor board, which has to be one already on the trail. */
  goTo(dir: string): void {
    const index = this.trail.indexOf(dir);
    if (index === -1) return;
    this.trail = this.trail.slice(0, index);
    this.view = dir;
    this.preview = null;
    this.derive();
  }

  /** A single click on a topic: its contents appear beside it, and the board stays. */
  togglePreview(topic: TopicObject | string): void {
    const path = typeof topic === "string" ? topic : topic.path;
    this.preview = this.preview === path ? null : path;
    this.derive();
  }

  /**
   * A file card was opened. A note goes to the editor, which is what reading one
   * means; anything the card already draws, or that nothing here can draw, is
   * handed to the browser under the same confinement as everything else.
   */
  openFile(file: FileObject): void {
    const cwd = this.board.cwd;
    if (cwd.length === 0) return;
    if (TEXT_EXTENSIONS.has(file.extension) && this.openNote?.(cwd, file.path)) return;

    const params = new URLSearchParams({ cwd, path: file.path });
    window.open(`/api/vault/file?${params.toString()}`, "_blank", "noopener");
  }

  /** The url a card loads its own bytes from. Empty until a project is open. */
  fileUrl(path: string): string | null {
    const cwd = this.board.cwd;
    if (cwd.length === 0) return null;
    return `/api/vault/file?${new URLSearchParams({ cwd, path }).toString()}`;
  }

  /** Whether taking this object off the board would mean anything. */
  canUnlink(id: string): boolean {
    return this.slice()[id] !== undefined;
  }

  /** A card the vault put there, whether it is placed on this board or previewed. */
  objectFor(id: string): BoardObject | null {
    const placed = this.cards.find((object) => object.id === id);
    if (placed) return placed;
    return this.contents.find((object) => object.id === id) ?? null;
  }

  /**
   * Cards released over a topic card, or over empty board space. The topic a drop
   * lands in is the destination directory (PLAN §5), so this is a real `mv`: the
   * link rewrite, the placement it vacates and the drag that caused it are one
   * undo step, because the history scope the drag opened is still held here.
   */
  async moveInto(ids: string[], toId: string | null): Promise<void> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0) return;

    const destination = this.destinationFor(toId);
    if (destination === null) return;

    const moving = ids
      .map((id) => this.objectFor(id))
      .filter((object): object is BoardObject => object !== null)
      .filter((object) => directoryOf(object.path) !== destination)
      // A topic cannot swallow itself. The server refuses it; not offering it is better.
      .filter(
        (object) => destination !== object.path && !destination.startsWith(`${object.path}/`),
      );
    if (moving.length === 0) return;

    const results: VaultMoveResult[] = [];
    for (const object of moving) {
      try {
        results.push(await transport.moveVaultEntry(cwd, object.path, destination));
      } catch (cause) {
        this.error = describe(cause);
      }
    }
    if (results.length === 0) return;

    this.board.attachAction({
      revert: async () => {
        // Reversed, so a batch that moved several items unwinds in the order it
        // was made, and each reversal rewrites only what its own move rewrote.
        for (const result of [...results].reverse()) {
          await transport.moveVaultEntry(cwd, result.to, directoryOf(result.from), {
            rewrite: result.rewritten,
          });
        }
        await this.refresh();
      },
      reapply: async () => {
        for (const result of results) {
          await transport.moveVaultEntry(cwd, result.from, destination);
        }
        await this.refresh();
      },
    });

    // The placement follows the path. An item that landed in this board's own
    // directory keeps the position it was dropped at; one that left has none here.
    const slice = this.slice();
    for (const result of results) {
      const existing = slice[result.from];
      delete slice[result.from];
      if (destination === this.view && existing) slice[result.to] = existing;
    }
    this.writeSlice(slice);
    await this.refresh();
  }

  /**
   * Bytes dropped or pasted onto the board become files in the board's own
   * directory (PLAN §7), placed where they landed rather than flowed in with the
   * rest. Answers with the vault paths that were written.
   */
  async writeFiles(files: readonly File[], at: Point): Promise<string[]> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0 || files.length === 0) return [];

    const written: string[] = [];
    const slice = this.slice();

    for (const [index, file] of files.entries()) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { path } = await transport.writeVaultFile(cwd, this.view, file.name, bytes);
        const size = sizeForExtension(path);
        slice[path] = { x: at.x + index * 24, y: at.y + index * 24, ...size, z: 1 };
        written.push(path);
      } catch (cause) {
        this.error = describe(cause);
      }
    }

    if (written.length === 0) return written;
    this.writeSlice(slice);
    await this.refresh();
    return written;
  }

  /**
   * Deleting the file itself, which is what a card in this board's own directory
   * has instead of an unlink. Not undoable: the bytes are gone, and pretending
   * otherwise would be worse than saying so.
   */
  async deleteEntry(path: string): Promise<void> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0) return;

    try {
      await transport.deleteVaultEntry(cwd, path);
    } catch (cause) {
      this.error = describe(cause);
      return;
    }

    const slice = this.slice();
    delete slice[path];
    this.writeSlice(slice);
    await this.refresh();
  }

  /**
   * Everything in the vault whose name, title or body answers to `query`. Plain
   * substring matching over the snapshot the board already holds: the vault is one
   * project's notes, and an index would be a cache to invalidate.
   */
  search(query: string, limit = 30): VaultSnapshotItem[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    const doc = this.doc;
    if (!doc) return [];

    const matched = doc.items.filter((item) => {
      if (item.name.toLowerCase().includes(needle)) return true;
      if (item.title?.toLowerCase().includes(needle)) return true;
      return item.preview.toLowerCase().includes(needle);
    });

    // A name match is what the searcher meant; a body match is what they settled for.
    return matched.sort((left, right) => rank(left, needle) - rank(right, needle)).slice(0, limit);
  }

  /** Brings an item's board up and selects it: what opening a search result means. */
  reveal(path: string): void {
    const directory = directoryOf(path);
    if (directory !== this.view) {
      // Going to the root is leaving the trail behind, not extending it.
      if (directory.length === 0) this.trail = [];
      else this.trail = [...this.trail, this.view];
      this.view = directory;
      this.preview = null;
    }
    this.derive();
  }

  /** Where a drop lands: a topic card's directory, or this board's own. */
  private destinationFor(toId: string | null): string | null {
    if (toId === null) return this.view;
    const target = this.objectFor(toId);
    if (!target || target.kind !== "topic") return null;
    return target.path;
  }

  /**
   * A card was dragged or resized. Its geometry is the placement, so that is what
   * moves — a preview card has no placement, and its place is the app's to choose.
   */
  private patchCard(id: string, patch: Partial<CanvasObject>): void {
    const geometry = readGeometry(patch);
    if (Object.keys(geometry).length === 0) return;

    const card = this.cards.find((object) => object.id === id);
    if (!card) return this.dragPreviewCard(id, geometry);

    // Cards are plain values, not board state, so moving one is a mutation of the
    // derived list plus a placement write — no copy of the file is involved.
    this.cards = this.cards.map((object) => {
      if (object.id !== id) return object;
      Object.assign(object, geometry);
      return object;
    });

    const slice = this.slice();
    const existing = slice[id];
    if (existing) {
      this.writeSlice({ ...slice, [id]: { ...existing, ...geometry } });
    }
    this.publish();
    this.repositionPreview();
  }

  /**
   * A preview card follows the pointer so it can be dropped somewhere, and nothing
   * more: the block is the app's arrangement, so the position is not written and
   * the next `derive` puts it back where the layout says it goes.
   */
  private dragPreviewCard(id: string, geometry: Partial<Placement>): void {
    const content = this.contents.find((object) => object.id === id);
    if (!content) return;
    Object.assign(content, geometry);
    this.contents = [...this.contents];
    this.publish();
  }

  /**
   * Taking a vault card off the board unlinks it: the placement goes, the file
   * stays. An item in this board's own directory has no placement to drop — it is
   * here because it is in the directory — so removing it means nothing, and the
   * caller is expected not to offer it.
   */
  private unlink(ids: string[]): void {
    const slice = this.slice();
    let changed = false;

    for (const id of ids) {
      if (slice[id] === undefined) continue;
      delete slice[id];
      changed = true;
    }
    if (!changed) return;

    this.writeSlice(slice);
    this.derive();
  }

  /** Recomputes both lists from the vault and the stored placements. */
  private derive(): void {
    const doc = this.doc;
    // A board can be switched between the server answering and this running, and a
    // vault that belongs to another directory must never be drawn on this one.
    if (!doc || doc.cwd !== this.board.cwd) {
      this.cards = [];
      this.contents = [];
      this.publish();
      return;
    }

    // An empty slice is dropped rather than stored, so the document never grows
    // dead keys for boards that hold nothing.
    const viewed = boardView({
      vault: doc,
      placements: this.slice(),
      board: this.view,
      size: (item) => (item.kind === "topic" ? TOPIC_SIZE : sizeForExtension(item.path)),
    });
    this.cards = viewed.objects;
    this.writeSlice(viewed.placements);
    this.repositionPreview();
    this.publish();
  }

  /**
   * The preview is the topic's own contents, laid out by the app rather than by any
   * stored position, starting to the right of the card it belongs to.
   */
  private repositionPreview(): void {
    const doc = this.doc;
    const path = this.preview;
    this.contents = [];

    if (doc && path !== null) {
      const card = this.cards.find((object) => object.kind === "topic" && object.path === path);
      if (card && card.kind === "topic") {
        this.contents = previewObjects(doc, path, {
          origin: { x: card.x + card.w + PREVIEW_GAP, y: card.y },
          maxWidth: PREVIEW_WIDTH,
        });
      }
    }
    this.publish();
  }

  /** What this board draws: its own cards, plus a previewed topic's contents. */
  private publish(): void {
    this.board.vault = [...this.cards, ...this.contents];
  }

  /** What one item points at, what points back, and what nearly does (PLAN §4). */
  links(path: string): LinkSummary | null {
    const doc = this.doc;
    if (!doc) return null;
    return linkSummary(doc, path);
  }

  private slice(): Record<string, Placement> {
    return { ...(this.board.doc.placements[this.view] ?? {}) };
  }

  /** Merges this board's slice back into the document, dropping it when empty. */
  private writeSlice(slice: Record<string, Placement>): void {
    const placements = { ...this.board.doc.placements };
    if (Object.keys(slice).length === 0) delete placements[this.view];
    else placements[this.view] = slice;
    this.board.setPlacements(placements);
  }
}

/** Media gets a bigger card than a note, which is the whole point of the size hook. */
function sizeForExtension(path: string): { w: number; h: number } {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return CARD_SIZE;
  return MEDIA_EXTENSIONS.has(path.slice(dot + 1).toLowerCase()) ? MEDIA_SIZE : CARD_SIZE;
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return "";
  return path.slice(0, slash);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Name first, then title, then body. A searcher who types a filename means the
 * file; a body hit is what they settled for.
 */
function rank(item: VaultSnapshotItem, needle: string): number {
  if (item.name.toLowerCase() === needle) return 0;
  if (item.name.toLowerCase().includes(needle)) return 1;
  if (item.title?.toLowerCase().includes(needle)) return 2;
  return 3;
}

/** Only the geometry a card owns, so an unrelated patch cannot write nonsense. */
function readGeometry(patch: Partial<CanvasObject>): Partial<Placement> {
  const geometry: Partial<Placement> = {};
  for (const key of ["x", "y", "w", "h"] as const) {
    const value = patch[key];
    if (typeof value === "number" && Number.isFinite(value)) geometry[key] = value;
  }
  return geometry;
}
