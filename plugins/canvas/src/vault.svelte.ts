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
import type { Placement, Size, VaultDoc, VaultSnapshotItem } from "@nib-ui/vault";
import type { BoardStore } from "./board.svelte";
import { cardKindFor, extensionOf, isImagePath, isMarkdownPath, isVideoPath } from "./card-kind";
import { collapse, createStackId, dissolve, membersOf, spread, type StackMember } from "./stacks";
import {
  type BoardObject,
  boardView,
  FOLDER_SIZE,
  type FolderObject,
  type LinkSummary,
  linkSummary,
  previewObjects,
  SHEET_SIZE,
  STICKY_SIZE,
  VISUAL_SIZE,
  WEBCLIP_SIZE,
} from "./board-view";

/** World units between a topic card and the block of its contents. */
const PREVIEW_GAP = 24;
/** How wide a previewed block of contents is allowed to get. */
const PREVIEW_WIDTH = 720;

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

  /** Page captures this window has, by the url they were taken of. */
  private captures = $state<Record<string, string>>({});
  /** The pile that is spread open, if any. Only one is open at a time. */
  private opened = $state<string | null>(null);

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
  enter(topic: FolderObject | string): void {
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
  togglePreview(topic: FolderObject | string): void {
    const path = typeof topic === "string" ? topic : topic.path;
    this.preview = this.preview === path ? null : path;
    this.derive();
  }

  /** Clicking away from everything puts a previewed folder back, and re-piles a stack. */
  closePreview(): void {
    const changed = this.preview !== null || this.opened !== null;
    if (!changed) return;
    this.preview = null;
    if (this.opened !== null) {
      const stack = this.opened;
      this.opened = null;
      this.repile(stack);
      return;
    }
    this.derive();
  }

  /**
   * Folds a selection into a pile at the centre of what it covered, with the card
   * nearest the cursor on top. Two is the fewest that can be a pile: one card in
   * a stack is just a card.
   */
  collapseStack(ids: readonly string[], cursor: Point): string | null {
    const slice = this.slice();
    const members = ids
      .map((path) => ({ path, placement: slice[path] }))
      .filter((entry): entry is StackMember => entry.placement !== undefined);
    if (members.length < 2) return null;

    const stack = createStackId();
    const folded = collapse(members, stack, cursor);
    if (!folded) return null;

    this.opened = null;
    this.writeSlice({ ...slice, ...folded.placements });
    this.board.setStacks({ ...this.board.doc.stacks, [stack]: folded.rect });
    this.derive();
    return stack;
  }

  /** A click on a pile: its cards fan out around it and the rest of the board dims. */
  openStack(stack: string): void {
    const rect = this.board.doc.stacks[stack];
    if (!rect) return;

    const slice = this.slice();
    this.opened = stack;
    this.preview = null;
    this.writeSlice({ ...slice, ...spread(membersOf(slice, stack), rect) });
    this.derive();
  }

  /** Clicking away from a spread pile puts the cards back into the cascade. */
  private repile(stack: string): void {
    const rect = this.board.doc.stacks[stack];
    const slice = this.slice();
    const members = membersOf(slice, stack);
    if (!rect || members.length === 0) {
      this.derive();
      return;
    }

    const folded = collapse(members, stack, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    if (folded) {
      this.writeSlice({ ...slice, ...folded.placements });
      this.board.setStacks({ ...this.board.doc.stacks, [stack]: folded.rect });
    }
    this.derive();
  }

  /** Takes a pile apart. The cards stay where they are; only the grouping goes. */
  dissolveStack(stack: string): void {
    const taken = dissolve(this.slice(), this.board.doc.stacks, stack);
    if (this.opened === stack) this.opened = null;
    this.writeSlice(taken.placements);
    this.board.setStacks(taken.stacks);
    this.derive();
  }

  /**
   * Writes a note's body back. The path never changes, so every `[[link]]` to the
   * note survives the save; the scan that follows is what brings the card's own
   * body back in line with what is on disk.
   */
  async writeText(path: string, text: string): Promise<void> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0) return;

    try {
      await transport.writeVaultText(cwd, path, text);
    } catch (cause) {
      this.error = describe(cause);
      return;
    }
    await this.refresh();
  }

  /** The pile a card is in, or null for one that is loose. */
  stackOf(path: string): string | null {
    return this.slice()[path]?.stack ?? null;
  }

  /** Whether this pile is the one spread open. */
  isOpen(stack: string): boolean {
    return this.opened === stack;
  }

  /**
   * What stays lit while a folder is previewed: the folder itself and the block
   * of its contents. Null when nothing is previewed, which is what leaves the
   * board undimmed.
   *
   * Held rather than derived on demand, because the engine reads it once per
   * frame and building the set each time would be an allocation per frame.
   */
  focus: ReadonlySet<string> | null = null;

  /**
   * A double click on empty board space. It writes a real, empty markdown file
   * into this board's directory — the vault is the truth, so a sticky exists on
   * disk before it exists on the board — places it where the cursor was, and
   * answers with the path so the caller can open its editor.
   */
  async createSticky(at: Point): Promise<string | null> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0) return null;

    try {
      // One empty line rather than no bytes at all: the bytes route refuses an
      // empty body, and a blank note is one blank line.
      const { path } = await transport.writeVaultFile(
        cwd,
        this.view,
        `${untitledName()}.md`,
        new TextEncoder().encode("\n"),
      );
      // Placed at the cursor rather than flowed in with the rest: the point of a
      // double click is that it says where.
      this.writeSlice({
        ...this.slice(),
        [path]: { x: Math.round(at.x), y: Math.round(at.y), ...STICKY_SIZE, z: 1 },
      });
      await this.refresh();
      return path;
    } catch (cause) {
      this.error = describe(cause);
      return null;
    }
  }

  /**
   * A file card was opened. A note goes to the editor, which is what reading one
   * means; anything the card already draws, or that nothing here can draw, is
   * handed to the browser under the same confinement as everything else.
   *
   * Takes the path rather than a card, because every kind that stands for a file
   * can be opened and only one of them carries an extension field.
   */
  openFile(file: { path: string }): void {
    const cwd = this.board.cwd;
    if (cwd.length === 0) return;
    if (TEXT_EXTENSIONS.has(extensionOf(file.path)) && this.openNote?.(cwd, file.path)) return;

    const params = new URLSearchParams({ cwd, path: file.path });
    window.open(`/api/vault/file?${params.toString()}`, "_blank", "noopener");
  }

  /** The url a card loads its own bytes from. Empty until a project is open. */
  fileUrl(path: string): string | null {
    const cwd = this.board.cwd;
    if (cwd.length === 0) return null;
    return `/api/vault/file?${new URLSearchParams({ cwd, path }).toString()}`;
  }

  /**
   * The capture taken of a page, or null while there is none — which is what puts
   * a webclip in its loading state. Held per window rather than on the board: a
   * capture belongs to a url, not to a placement, and the cache behind it is the
   * server's `link-previews/` directory.
   */
  captureUrl(url: string): string | null {
    return this.captures[url] ?? null;
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
        const size = sizeForPath(path);
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
    if (!target || target.kind !== "folder") return null;
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
      size: sizeForItem,
      stacks: this.board.doc.stacks,
    });
    this.cards = viewed.objects;
    this.writeSlice(viewed.placements);
    // A pile whose every member is gone goes with them, and a card left pointing
    // at one that is not there has already been taken out of it by `reconcile`.
    this.board.setStacks(viewed.stacks);
    if (this.opened !== null && viewed.stacks[this.opened] === undefined) this.opened = null;
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
      const card = this.cards.find((object) => object.kind === "folder" && object.path === path);
      if (card && card.kind === "folder") {
        this.contents = previewObjects(doc, path, {
          origin: { x: card.x + card.w + PREVIEW_GAP, y: card.y },
          maxWidth: PREVIEW_WIDTH,
          size: sizeForItem,
        });
      }
    }
    // What is being looked at stays lit and everything else drops to the dim:
    // a previewed folder with its contents beside it, or a pile spread open.
    // Nothing moves, which is what makes both read as looking closer.
    this.focus = this.focusSet(path);
    this.publish();
  }

  /**
   * What stays lit. A previewed folder keeps its own card and the block beside
   * it; a spread pile keeps its members. Null leaves the whole board at full
   * strength, which is the resting state.
   */
  private focusSet(previewed: string | null): ReadonlySet<string> | null {
    if (previewed !== null)
      return new Set([previewed, ...this.contents.map((object) => object.id)]);

    const opened = this.opened;
    if (opened === null) return null;
    return new Set(membersOf(this.slice(), opened).map((member) => member.path));
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

/**
 * How big a card starts, before anyone resizes it. What the item is drawn as is
 * what decides: a sheet is a page and wants a page's proportions, a picture wants
 * room to be looked at, and a sticky is the small one beside them.
 */
/**
 * The size a file just written to disk is placed at. It has not been scanned yet,
 * so there is no item to classify and only the name can be gone on — which is
 * enough for the two that matter, since a picture and a note want very different
 * room. The next scan cannot change it: by then the placement is stored.
 */
function sizeForPath(path: string): Size {
  if (isImagePath(path) || isVideoPath(path)) return VISUAL_SIZE;
  if (isMarkdownPath(path)) return STICKY_SIZE;
  return SHEET_SIZE;
}

function sizeForItem(item: VaultSnapshotItem): Size {
  switch (cardKindFor(item)) {
    case "folder":
      return FOLDER_SIZE;
    case "sheet":
      return SHEET_SIZE;
    case "visual":
      return VISUAL_SIZE;
    case "webclip":
      return WEBCLIP_SIZE;
    case "sticky":
      return STICKY_SIZE;
  }
}

/**
 * The name a new sticky gets. It is a real filename the moment it is created, so
 * it has to be one nothing else is likely to hold; the user renames it by giving
 * the note a title, which is what the vault reads a name from.
 */
function untitledName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `untitled-${stamp}`;
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
