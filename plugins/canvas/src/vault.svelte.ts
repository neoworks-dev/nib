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
import type { MessageAttachment } from "@nib-ui/protocol";
import type {
  CanvasObject,
  Point,
  SessionsService,
  TransportService,
  VaultMoveResult,
} from "@nib-ui/ui-contracts";
import { setMetaString } from "@nib-ui/vault";
import type { Placement, Rect, Size, TrashEntry, VaultDoc, VaultSnapshotItem } from "@nib-ui/vault";
import { untrack } from "svelte";
import { STICKY_DEFAULT_COLOR, type StickyColor } from "./theme";
import type { BoardStore } from "./board.svelte";
import {
  cardKindFor,
  extensionOf,
  isDiagramPath,
  isImagePath,
  isMarkdownPath,
  isVideoPath,
  sessionIdOf,
} from "./card-kind";
import { documentToMarkdown, parseDocument, toggleTask } from "./markdown";
import {
  arrangeGrid,
  boundsOf,
  collapse,
  createStackId,
  dissolve,
  membersOf,
  pileRect,
  release,
  spread,
  type StackMember,
} from "./stacks";
import {
  type BoardObject,
  boardView,
  DIAGRAM_SIZE,
  FILE_SIZE,
  FOLDER_SIZE,
  type FolderObject,
  type LinkSummary,
  linkSummary,
  PREVIEW_WIDTH,
  previewObjects,
  pushAside,
  SHEET_SIZE,
  STICKY_SIZE,
  TRANSCRIPT_SIZE,
  VISUAL_SIZE,
  WEBCLIP_SIZE,
} from "./board-view";

/** World units between a topic card and the block of its contents. */
const PREVIEW_OFFSET = 24;

/**
 * What a topic made out of a selection is called. It is a directory name the user
 * renames on disk, so it says what it is rather than guessing at what the cards
 * have in common.
 */
const NEW_TOPIC_NAME = "New topic";

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

/**
 * What a scrape of a page came back with: the picture the card draws, and what
 * the page calls itself. The title is the card's, not the file's — a webclip's
 * file holds a url and nothing else, so the page is the only thing that can name it.
 */
export interface PageCapture {
  /** Where the capture's bytes are, in the asset store. */
  image: string;
  title: string;
  /** The host, drawn under the title; empty for a url that would not parse. */
  domain: string;
}

export class VaultStore {
  transport = $state<TransportService | null>(null);
  /**
   * Set by the app, for lineage: a transcript of an agent another agent spawned
   * is folded into its spawner's card — read through its tabs — rather than
   * drawn as a chat of its own.
   */
  sessions = $state<SessionsService | null>(null);
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
  private captures = $state<Record<string, PageCapture>>({});
  /** The pile that is spread open, if any. Only one is open at a time. */
  private opened = $state<string | null>(null);
  /** Where the open pile sat before it was spread, which the board parts around. */
  private openedFrom: Rect | null = null;

  /**
   * Set by the app: reading a note is the editor's business. It answers false when
   * there is no editor loaded, and the browser gets the file instead.
   */
  openNote: ((cwd: string, path: string) => boolean) | null = null;

  /**
   * Set by the app: these paths are no longer in the vault. Whatever was showing
   * one has to stop — a pane open on a note that has been deleted is a window onto
   * nothing, and its unsaved buffer would write the file back if it were flushed.
   *
   * Reported off the scan rather than from the delete itself, so a file an agent
   * removed with `rm` closes its pane too.
   */
  onPathsGone: ((paths: readonly string[]) => void) | null = null;

  /** What is in the recycling bin, newest first; read when the bin is opened. */
  trash = $state<TrashEntry[]>([]);

  /**
   * How many times each path has been away. It goes into the url a card loads
   * from, which is the only way a *new* file at an old path is fetched: Pixi caches
   * a texture by the url it was asked for, so re-uploading `photo.png` after
   * deleting one drew the deleted picture. The count is per window and not
   * persisted — a reload has no cache to bust.
   */
  private versions = new Map<string, number>();
  /** Paths the last scan reported, for telling what has gone since. */
  private known: ReadonlySet<string> = new Set();

  /** This board's own cards, positioned by the placements map. */
  private cards: BoardObject[] = [];
  /** The previewed topic's contents, laid out by the app and never persisted. */
  private contents: BoardObject[] = [];
  /**
   * How far sideways each card is moved while a folder is open, by id. `cards`
   * keeps their real positions; the push is applied on the way out and taken
   * off a drag on the way in, so nothing of it reaches the placements.
   */
  private pushed: ReadonlyMap<string, number> = new Map();
  /**
   * Paths a drag borrowed a placement for when it took them out of a preview,
   * by the path they had when it began. Cleared as each drag settles.
   */
  private readonly detached = new Set<string>();
  /** The filesystem watch for the open project, so a model's write shows up. */
  private stream: Disposer | null = null;
  /** The project `stream` is watching, so re-opening the same one is a no-op. */
  private watched: string | null = null;

  /**
   * The sessions whose transcript belongs on another card. Sorted and joined so
   * it only changes when the set does: the summaries are re-read on a timer,
   * and redrawing the board on every tick would be most of what the board did.
   */
  private readonly spawnedKey = $derived(
    (this.sessions?.summaries ?? [])
      .filter((summary) => summary.parentSessionId !== null)
      .map((summary) => summary.id)
      .sort()
      .join("\n"),
  );

  constructor(private readonly board: BoardStore) {
    board.onVaultObjectPatch = (id, patch) => this.patchCard(id, patch);
    board.onVaultObjectsRemoved = (ids) => this.removeCards(ids);
    board.onBoardSynced = () => this.derive();
    // A spawned agent's transcript lands in the vault before the session list
    // says who spawned it, so the fold has to follow the list, not the scan.
    $effect.root(() => {
      $effect(() => {
        void this.spawnedKey;
        untrack(() => this.derive());
      });
    });
  }

  /** True for the transcript of an agent another agent spawned. */
  private folded(item: VaultSnapshotItem): boolean {
    if (cardKindFor(item) !== "transcript") return false;
    const sessionId = sessionIdOf(item.path);
    const summary = this.sessions?.summaries.find((entry) => entry.id === sessionId);
    return summary?.parentSessionId != null;
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
    // Another project's paths are not paths that have gone: what is open on them
    // belongs to a board this window is no longer showing.
    this.known = new Set();
    this.versions.clear();
    this.trash = [];
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
      this.noteVanished(doc);
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
   * Folds a selection into a pile at the centre of what it covered, largest card
   * at the back. Two is the fewest that can be a pile: one card in a stack is
   * just a card.
   */
  collapseStack(ids: readonly string[]): string | null {
    const slice = this.slice();
    const members = ids
      .map((path) => ({ path, placement: slice[path] }))
      .filter((entry): entry is StackMember => entry.placement !== undefined);
    if (members.length < 2) return null;

    const stack = createStackId();
    const folded = collapse(members, stack);
    if (!folded) return null;

    this.opened = null;
    this.writeSlice({ ...slice, ...folded.placements });
    this.board.setStacks({ ...this.board.doc.stacks, [stack]: folded.rect });
    this.derive();
    return stack;
  }

  /** A click on a pile: its cards fan out around it and the rest of the board dims. */
  openStack(stack: string): void {
    const slice = this.slice();
    const members = membersOf(slice, stack);
    // Where the cards are now, not where the pile was stored: a drag moves
    // placements and leaves the stored rectangle behind, and spreading around that
    // one threw the pile back to wherever it was last folded.
    const rect = pileRect(members);
    if (!rect) return;

    this.opened = stack;
    this.openedFrom = rect;
    this.preview = null;
    this.writeSlice({ ...slice, ...spread(members, rect) });
    this.board.setStacks({ ...this.board.doc.stacks, [stack]: rect });
    this.derive();
  }

  /**
   * Clicking away from a spread pile puts the cards back into the cascade, at the
   * rectangle the pile already had rather than at the middle of the block they
   * were spread into.
   */
  private repile(stack: string): void {
    const rect = this.board.doc.stacks[stack];
    const slice = this.slice();
    const members = membersOf(slice, stack);
    if (!rect || members.length === 0) {
      this.derive();
      return;
    }

    const folded = collapse(members, stack, {
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
    });
    if (folded) {
      this.writeSlice({ ...slice, ...folded.placements });
      this.board.setStacks({ ...this.board.doc.stacks, [stack]: folded.rect });
    }
    this.derive();
  }

  /**
   * A drag has begun on these cards. Whatever they were laid out as part of is
   * put away before they move: an opened folder closes and a spread pile folds
   * back, so the drag crosses a board showing where the cards can land rather
   * than one still covered by the block they came out of.
   *
   * A card dragged out of a preview is given a placement on this board first. It
   * is a card on the table from that moment — its file is still in the topic, and
   * a board shows what is placed on it wherever the file lives — so the drag has
   * something to carry once the block it was part of is gone. Dropping it is
   * what moves the file; letting go decides where.
   */
  beginDrag(ids: readonly string[]): void {
    const opened = this.opened;
    if (opened !== null) {
      const members = new Set(membersOf(this.slice(), opened).map((member) => member.path));
      if (ids.some((id) => members.has(id))) {
        this.releaseFromStacks(ids);
        // A pile the release already took apart is gone; one still standing is
        // folded back up now that a card has left it.
        if (this.opened !== null) {
          const stack = this.opened;
          this.opened = null;
          this.repile(stack);
        }
        return;
      }
    }

    if (this.preview === null) return;
    const leaving = this.contents.filter((object) => ids.includes(object.id));
    if (leaving.length === 0) return;

    const slice = this.slice();
    for (const object of leaving) {
      slice[object.id] = { x: object.x, y: object.y, w: object.w, h: object.h, z: 1 };
      this.detached.add(object.id);
    }
    this.preview = null;
    this.writeSlice(slice);
    this.derive();
  }

  /**
   * The drag those cards were picked up for is over. One that came out of a
   * preview and did not move — dropped back inside its own topic, or refused —
   * gives its placement up again and goes back into the folder.
   *
   * Without this the borrowed placement outlives the gesture, and a topic's
   * contents end up scattered across its parent's board as cards nobody put
   * there: a drag that changed nothing would have changed where two boards say
   * that item lives.
   */
  settleDrag(ids: readonly string[]): void {
    const slice = this.slice();
    let changed = false;
    for (const id of ids) {
      if (!this.detached.delete(id)) continue;
      // A card that did move is at a new path, and `moveInto` has already taken
      // the old placement with it.
      if (directoryOf(id) === this.view || slice[id] === undefined) continue;
      delete slice[id];
      changed = true;
    }
    if (!changed) return;
    this.writeSlice(slice);
    this.derive();
  }

  /**
   * Cards let go after a drag. One dragged clear of its pile has left it, and a
   * pile that loses all but one card is taken apart with it.
   */
  releaseFromStacks(ids: readonly string[]): void {
    const slice = this.slice();
    const released = release(slice, this.board.doc.stacks, ids);
    if (this.opened !== null && released.stacks[this.opened] === undefined) this.opened = null;
    this.writeSlice(released.placements);
    this.board.setStacks(released.stacks);
    this.derive();
  }

  /** Lays the cards out as a grid, starting where the top left of them was. */
  arrangeGrid(ids: readonly string[]): void {
    const slice = this.slice();
    const members = ids
      .map((path) => ({ path, placement: slice[path] }))
      .filter((entry): entry is StackMember => entry.placement !== undefined);
    if (members.length < 2) return;
    this.writeSlice({ ...slice, ...arrangeGrid(members) });
    this.derive();
  }

  /**
   * Takes a pile apart. A pile that is spread open is already apart, and its
   * cards stay where they are; a folded one is fanned out first, or the cards
   * would be left sitting on each other with nothing to say they were a pile.
   */
  dissolveStack(stack: string): void {
    let slice = this.slice();
    const members = membersOf(slice, stack);
    const rect = pileRect(members);
    if (this.opened !== stack && rect) slice = { ...slice, ...spread(members, rect) };
    const taken = dissolve(slice, this.board.doc.stacks, stack);
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

  /**
   * Ticks a task on a card that is not open for editing. The file is read back
   * rather than patched from the card's own body, because that body is clipped
   * and a write built from it would truncate the note.
   */
  async toggleTask(path: string, line: number): Promise<void> {
    const url = this.fileUrl(path);
    if (url === null) return;

    try {
      const response = await fetch(url);
      if (!response.ok) return;

      const document = parseDocument(await response.text());
      const block = document.blocks[line];
      if (!block || block.style !== "task") return;

      document.blocks[line] = toggleTask(block);
      await this.writeText(path, documentToMarkdown(document));
    } catch (cause) {
      this.error = describe(cause);
    }
  }

  /**
   * Paints a note. The colour is the note's own — it goes in its frontmatter, so
   * it travels with the file and can be written by hand or by a model — and the
   * file is read back before it is written for the same reason ticking a task
   * reads it back: the card carries a clipped body, and a write built from that
   * would truncate the note.
   */
  async setColor(path: string, color: StickyColor): Promise<void> {
    const url = this.fileUrl(path);
    if (url === null) return;

    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const source = await response.text();
      // The default is what a note with no `color:` already reads as, so asking
      // for it takes the key back out rather than writing it in.
      const wanted = color === STICKY_DEFAULT_COLOR ? null : color;
      await this.writeText(path, setMetaString(source, "color", wanted));
    } catch (cause) {
      this.error = describe(cause);
    }
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

  /**
   * The url a card loads its own bytes from. Empty until a project is open.
   *
   * Carries the path's version once it has had one, which the server ignores and
   * every cache in front of it does not: a file written at a path that was deleted
   * is a different file, and without this it is fetched as the old one.
   */
  fileUrl(path: string): string | null {
    const cwd = this.board.cwd;
    if (cwd.length === 0) return null;
    const params = new URLSearchParams({ cwd, path });
    const version = this.versions.get(path);
    if (version !== undefined) params.set("v", String(version));
    return `/api/vault/file?${params.toString()}`;
  }

  /**
   * What the scan no longer holds. Two things follow a path out of the vault: the
   * app is told, so whatever was showing it closes, and the path's version is
   * bumped so a file written there later is fetched rather than remembered.
   *
   * A directory is reported along with everything that was under it, because the
   * items under it left the snapshot too.
   */
  private noteVanished(doc: VaultDoc): void {
    const current = new Set(doc.items.map((item) => item.path));
    const gone = [...this.known].filter((path) => !current.has(path));
    this.known = current;
    if (gone.length === 0) return;

    for (const path of gone) this.versions.set(path, (this.versions.get(path) ?? 0) + 1);
    this.onPathsGone?.(gone);
  }

  /**
   * A vault file as an attachment: copied into the asset store on the server,
   * which answers with the id a prompt names it by. Asked again for every
   * launch rather than cached, since the file may have changed underneath and
   * the store is addressed by content anyway.
   */
  async attachmentsFor(path: string, name: string): Promise<MessageAttachment[]> {
    const cwd = this.board.cwd;
    if (cwd.length === 0) return [];
    const query = new URLSearchParams({ cwd, path }).toString();
    const response = await fetch(`/api/vault/asset?${query}`, { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    const stored = (await response.json()) as { assetId: string; contentType: string };
    return [{ assetId: stored.assetId, mime: stored.contentType, name }];
  }

  /**
   * The capture taken of a page, or null while there is none — which is what puts
   * a webclip in its loading state. Held per window rather than on the board: a
   * capture belongs to a url, not to a placement, and the cache behind it is the
   * server's `link-previews/` directory.
   */
  capture(url: string): PageCapture | null {
    return this.captures[url] ?? null;
  }

  /**
   * A url pasted or dropped on empty board space. The note is written first and
   * the capture asked for after: the vault is the truth, so a webclip is a file
   * holding a url before it is a picture of a page, and a site that never answers
   * leaves a real note rather than nothing at all.
   */
  async createWebclip(url: string, at: Point): Promise<string | null> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0) return null;

    try {
      const { path } = await transport.writeVaultFile(
        cwd,
        this.view,
        `${clipName(url)}.md`,
        new TextEncoder().encode(`${url}\n`),
      );
      this.writeSlice({
        ...this.slice(),
        [path]: { x: Math.round(at.x), y: Math.round(at.y), ...WEBCLIP_SIZE, z: 1 },
      });
      await this.refresh();
      void this.requestCapture(url);
      return path;
    } catch (cause) {
      this.error = describe(cause);
      return null;
    }
  }

  /**
   * Asks the server for a capture of a page. It is the same cache the bookmark
   * cards use — `link-previews/` in XDG — so a url already seen answers without
   * a second fetch, and the picture arrives as an asset id rather than as a url
   * the board would hotlink.
   */
  async requestCapture(url: string): Promise<void> {
    if (this.captures[url] !== undefined) return;

    try {
      const response = await fetch("/api/link-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) return;

      const preview = (await response.json()) as {
        imageAssetId?: string;
        title?: string;
        domain?: string;
      };
      // No picture on the page: the card keeps waiting rather than claiming a
      // capture that does not exist.
      if (!preview.imageAssetId) return;
      this.captures = {
        ...this.captures,
        [url]: {
          image: `/api/assets/${encodeURIComponent(preview.imageAssetId)}`,
          // A page that named itself is what the card is called; one that did not
          // falls to its url, which is what the file itself holds anyway.
          title: preview.title && preview.title.length > 0 ? preview.title : url,
          domain: preview.domain ?? "",
        },
      };
    } catch {
      // A site that would not answer leaves the card in its loading state, which
      // is what the close button under it is for.
    }
  }

  /** Every webclip on this board asks for its capture once the vault is read. */
  private requestCaptures(): void {
    for (const card of this.cards) {
      if (card.kind === "webclip") void this.requestCapture(card.url);
    }
  }

  /**
   * Whether taking this object off the board would mean anything. An item in this
   * board's own directory is here because it is in the directory, so there is no
   * link to break: the only removal it has is deleting the file.
   */
  canUnlink(id: string): boolean {
    if (directoryOf(id) === this.view) return false;
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
    const destination = this.destinationFor(toId);
    if (destination === null) return;
    await this.moveTo(ids, destination);
  }

  /**
   * Several cards into a topic of their own: a directory beside them in this
   * board's folder, with their files moved into it. The topic's card takes the
   * middle of what the selection covered, so the gesture reads as those cards
   * becoming a folder rather than as them leaving the board.
   */
  async groupIntoTopic(ids: string[]): Promise<string | null> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0 || ids.length === 0) return null;

    const slice = this.slice();
    const covered = boundsOf(
      ids
        .map((id) => slice[id])
        .filter((placement): placement is Placement => placement !== undefined),
    );
    const name = this.freeTopicName();
    const topic = this.view.length === 0 ? name : `${this.view}/${name}`;

    const moved = await this.moveTo(ids, topic, {
      // The directory the move created is only there because of this gesture, so
      // undoing it takes the empty topic with it — the alternative is a folder the
      // user never asked for left on the board after a ctrl+z.
      revert: async () => {
        await transport.deleteVaultEntry(cwd, topic);
      },
    });
    if (!moved) return null;

    if (covered) {
      this.writeSlice({
        ...this.slice(),
        [topic]: {
          x: Math.round(covered.x + covered.w / 2 - FOLDER_SIZE.w / 2),
          y: Math.round(covered.y + covered.h / 2 - FOLDER_SIZE.h / 2),
          ...FOLDER_SIZE,
          z: 1,
        },
      });
      this.derive();
    }
    return topic;
  }

  /**
   * A name nothing in this board's directory holds. `mv` into an existing topic is
   * a merge, so a second grouping must not land in the first one's folder.
   */
  private freeTopicName(): string {
    const taken = new Set(
      (this.doc?.items ?? [])
        .filter((item) => item.dir === this.view)
        .map((item) => item.name.toLowerCase()),
    );
    if (!taken.has(NEW_TOPIC_NAME.toLowerCase())) return NEW_TOPIC_NAME;
    for (let suffix = 2; ; suffix += 1) {
      const name = `${NEW_TOPIC_NAME} ${suffix}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
  }

  /** Answers whether anything moved, so a caller can place what it created. */
  private async moveTo(
    ids: string[],
    destination: string,
    hooks: { revert?: () => Promise<void> } = {},
  ): Promise<boolean> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0) return false;

    const moving = ids
      .map((id) => this.objectFor(id))
      .filter((object): object is BoardObject => object !== null)
      .filter((object) => directoryOf(object.path) !== destination)
      // A topic cannot swallow itself. The server refuses it; not offering it is better.
      .filter(
        (object) => destination !== object.path && !destination.startsWith(`${object.path}/`),
      );
    if (moving.length === 0) return false;

    const results: VaultMoveResult[] = [];
    for (const object of moving) {
      try {
        results.push(await transport.moveVaultEntry(cwd, object.path, destination));
      } catch (cause) {
        this.error = describe(cause);
      }
    }
    if (results.length === 0) return false;

    // Where each card sat before the drop, for the reversal to put back. The board
    // restores these in its own snapshot too, but it does that while the files are
    // still at their new paths, and a placement for a path the vault does not hold
    // is pruned as stale — so the card would come home to a flowed slot.
    const before = this.slice();
    const vacated: Record<string, Placement> = {};
    for (const result of results) {
      const placement = before[result.from];
      if (placement) vacated[result.from] = placement;
    }

    this.board.attachAction({
      revert: async () => {
        // Reversed, so a batch that moved several items unwinds in the order it
        // was made, and each reversal rewrites only what its own move rewrote.
        for (const result of [...results].reverse()) {
          await transport.moveVaultEntry(cwd, result.to, directoryOf(result.from), {
            rewrite: result.rewritten,
          });
        }
        await hooks.revert?.();
        await this.refresh();
        if (Object.keys(vacated).length === 0) return;
        // Written after the scan has the files home again, which is the only order
        // the positions survive in, and derived because the cards come from them.
        this.writeSlice({ ...this.slice(), ...vacated });
        this.derive();
      },
      reapply: async () => {
        for (const result of results) {
          await transport.moveVaultEntry(cwd, result.from, destination);
        }
        await this.refresh();
      },
    });

    // The placement follows the path. An item that landed in this board's own
    // directory keeps the position it was dropped at — a card dragged out of a
    // folder's preview has no placement yet, so it is placed where the drag let
    // go of it rather than flowed in with the rest. One that left has none here.
    const slice = this.slice();
    const dragged = new Map(moving.map((object) => [object.path, object]));
    for (const result of results) {
      const existing = slice[result.from];
      delete slice[result.from];
      if (destination !== this.view) continue;
      if (existing) {
        slice[result.to] = existing;
        continue;
      }
      const object = dragged.get(result.from);
      if (object) slice[result.to] = { x: object.x, y: object.y, w: object.w, h: object.h, z: 1 };
    }
    this.writeSlice(slice);
    await this.refresh();
    return true;
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
   * has instead of an unlink.
   *
   * The entry goes to the recycling bin rather than being unlinked, so the gesture
   * is undoable — ctrl+z puts the file back and the card with it — and still
   * recoverable from the bin after the stack is gone. Nothing is asked first: a
   * confirm box is a worse guarantee than a reversal, and it made deleting a card
   * a two-step gesture for something that is one.
   */
  async deleteEntry(path: string): Promise<void> {
    await this.deleteEntries([path]);
  }

  /**
   * Deletes several at once as **one** undo step: pressing Delete on three
   * selected cards is one gesture, so putting them back is one ctrl+z rather
   * than three.
   */
  async deleteEntries(paths: readonly string[]): Promise<void> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0 || paths.length === 0) return;

    const slice = this.slice();
    const binned: { entry: TrashEntry; placement: Placement | undefined }[] = [];
    for (const path of paths) {
      try {
        const entry = await transport.trashVaultEntry(cwd, path);
        binned.push({ entry, placement: slice[path] });
        delete slice[path];
      } catch (cause) {
        this.error = describe(cause);
      }
    }
    if (binned.length === 0) return;

    // Where the cards come back is this action's own business. The board does
    // restore the placements in its snapshot, but it restores them while the files
    // are still in the bin — and a placement for a path the vault does not hold is
    // pruned as stale by the next derive, after which the card returns at a fresh
    // flowed slot instead of where it was deleted from.
    //
    // So the positions are written *after* the scan that has the files back, which
    // is the only order they survive in: an item the scan knows about, with a
    // stored placement, is one every later derive leaves where it is.
    this.board.attachAction({
      revert: async () => {
        const places: Record<string, Placement> = {};
        for (const item of [...binned].reverse()) {
          // The name may have been taken while the entry sat in the bin, in which
          // case the file is back under a new one and the placement follows it.
          const restored = await transport.restoreTrashEntry(cwd, item.entry.id);
          if (item.placement) places[restored.path] = item.placement;
        }
        await this.refresh();
        if (Object.keys(places).length === 0) return;
        this.writeSlice({ ...this.slice(), ...places });
        // The cards are derived from the placements, so writing them is only half
        // of putting them back.
        this.derive();
      },
      reapply: async () => {
        for (const item of binned) {
          item.entry = await transport.trashVaultEntry(cwd, item.entry.path);
        }
        await this.refresh();
      },
    });

    this.writeSlice(slice);
    await this.refresh();
  }

  /** Re-reads the bin. The pane that lists it asks for this when it opens. */
  async loadTrash(): Promise<void> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0) return;

    try {
      this.trash = await transport.listTrash(cwd);
    } catch (cause) {
      this.error = describe(cause);
    }
  }

  /**
   * Puts a binned entry back. Not an undo step of its own: the undo stack is a
   * stack of gestures, and restoring something from last week out of the bin is
   * not a reversal of whatever the last gesture was.
   */
  async restoreFromTrash(id: string): Promise<void> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0) return;

    try {
      await transport.restoreTrashEntry(cwd, id);
    } catch (cause) {
      this.error = describe(cause);
      return;
    }
    await this.loadTrash();
    await this.refresh();
  }

  /** Throws bytes away for good: one entry, or the whole bin. */
  async purgeTrash(id?: string): Promise<void> {
    const transport = this.transport;
    const cwd = this.board.cwd;
    if (!transport || cwd.length === 0) return;

    try {
      await transport.purgeTrash(cwd, id);
    } catch (cause) {
      this.error = describe(cause);
      return;
    }
    await this.loadTrash();
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
    // The pointer moved the card where it is drawn, which for a pushed card is
    // beside where it is.
    const push = this.pushed.get(id);
    if (push !== undefined && geometry.x !== undefined) geometry.x -= push;

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
   * Taking a vault card off the board. What that means depends on why the card is
   * here: one placed from elsewhere is unlinked, and its file is left alone.
   *
   * An item in this board's own directory is here because it is in the directory,
   * so dropping its placement takes it nowhere — the next scan puts it back, at a
   * fresh flowed position, which is the card wandering off rather than going. The
   * only removal that means anything for those is deleting the file, which files it
   * in the recycling bin and is undone by ctrl+z like any other gesture.
   */
  private removeCards(ids: string[]): void {
    const slice = this.slice();
    const owned = ids.filter((id) => directoryOf(id) === this.view);
    const placed = ids.filter((id) => !owned.includes(id) && slice[id] !== undefined);

    if (placed.length > 0) {
      for (const id of placed) delete slice[id];
      this.writeSlice(slice);
      this.derive();
    }
    void this.deleteEntries(owned);
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
      omit: (item) => this.folded(item),
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
    this.requestCaptures();
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
    this.pushed = new Map();

    if (doc && path !== null) {
      const card = this.cards.find((object) => object.kind === "folder" && object.path === path);
      if (card && card.kind === "folder") {
        // The folder's card empties: what it held is now on the table beside it.
        this.cards = this.cards.map((object) =>
          object === card ? { ...card, opened: true } : object,
        );
        this.contents = previewObjects(doc, path, {
          origin: { x: card.x + card.w + PREVIEW_OFFSET, y: card.y },
          maxWidth: PREVIEW_WIDTH,
          size: sizeForItem,
          // Every card in the block comes out of its own sheet inside the
          // folder, so opening a topic reads as the folder spilling rather than
          // as a second board appearing beside it.
          from: { x: card.x, y: card.y, w: card.w, h: card.h },
        });
        // The board parts around the folder and its contents, so opening one
        // reads as zooming in on them rather than as a block landing on top of
        // its neighbours.
        this.pushed = pushAside(
          this.cards,
          card,
          this.contents,
          new Set([card.id, ...this.contents.map((object) => object.id)]),
          PREVIEW_OFFSET,
        );
      }
    }
    if (this.opened !== null && this.openedFrom !== null) {
      // The same parting around a spread pile, measured from where the pile sat
      // folded: its members have already moved out to where they are.
      const members = new Set(membersOf(this.slice(), this.opened).map((member) => member.path));
      const block = this.cards.filter((card) => members.has(card.id));
      this.pushed = pushAside(this.cards, this.openedFrom, block, members, PREVIEW_OFFSET);
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

  /**
   * What this board draws: a previewed topic's contents, then its own cards.
   * Board order is z-order, so the contents go first: a card coming out of a
   * folder starts inside it, behind its front panel, and has to slide out from
   * under it. Drawn over the folder they read as landing on top of it instead.
   * Nothing else can overlap them — the board parts around the block.
   */
  private publish(): void {
    const cards = this.cards.map((card) => {
      const push = this.pushed.get(card.id);
      return push === undefined ? card : { ...card, x: card.x + push };
    });
    this.board.vault = [...this.contents, ...cards];
  }

  /**
   * Where a `[[link]]` written in `from` lands, or null for a name nothing in the
   * vault answers to. The resolution is the scan's, not this window's: the same
   * answer the links panel and the backlinks are built from.
   */
  linkTarget(from: string, target: string): string | null {
    const link = this.doc?.links.find((entry) => entry.from === from && entry.target === target);
    return link?.to ?? null;
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
  if (isDiagramPath(path)) return DIAGRAM_SIZE;
  if (isMarkdownPath(path)) return STICKY_SIZE;
  return FILE_SIZE;
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
    case "diagram":
      return DIAGRAM_SIZE;
    case "sticky":
      return STICKY_SIZE;
    case "file":
      return FILE_SIZE;
    case "transcript":
      return TRANSCRIPT_SIZE;
  }
}

/**
 * The name a new sticky gets. It is a real filename the moment it is created, so
 * it has to be one nothing else is likely to hold; the user renames it by giving
 * the note a title, which is what the vault reads a name from.
 */
/**
 * The filename a webclip gets: the site and its path, which is what a person
 * would call it. The url itself is the body, so this only has to be readable.
 */
function clipName(url: string): string {
  try {
    const parsed = new URL(url);
    const tail =
      parsed.pathname
        .split("/")
        .filter((part) => part.length > 0)
        .at(-1) ?? "";
    return tail.length > 0 ? `${parsed.hostname} ${tail}` : parsed.hostname;
  } catch {
    return "clip";
  }
}

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
