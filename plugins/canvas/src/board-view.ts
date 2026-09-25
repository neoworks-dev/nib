/**
 * What one board draws, derived from the vault.
 *
 * A board is one directory's canvas (PLAN §5), so it holds exactly two sets of
 * things: what lives directly in its own directory, and whatever was explicitly
 * placed on it from somewhere else. An ancestor's items do **not** appear on a
 * deeper board unless they were added to it — that is decision 7's symlink, and it
 * is why `placements` for this board is part of the input rather than the whole
 * vault being shown.
 *
 * Pure: no Pixi, no reactivity. The engine receives the result as ordinary objects.
 */

import type { CanvasObject } from "@nib-ui/ui-contracts";
import {
  type CardKind,
  cardKindFor,
  diagramSource,
  extensionOf,
  headingTitle,
  isVideoPath,
  sessionIdOf,
  urlBody,
} from "./card-kind";
import {
  type Placement,
  type ReconcileOptions,
  type Rect,
  type Size,
  type SlotChooser,
  type StackMap,
  type VaultSnapshot,
  type VaultSnapshotItem,
  packSlot,
  reconcileBoard,
} from "@nib-ui/vault";
import { folderSheets, type SheetSlot } from "./folder-sheets";
import { type StickyColor, stickyColor } from "./theme";

/** A wallet standing upright, which is the shape the thing it stands for has. */
export const FOLDER_SIZE: Size = { w: 280, h: 400 };
/** The small one: a sticky is about 85% the width of the sheet beside it. */
export const STICKY_SIZE: Size = { w: 256, h: 300 };
/** A page, so it is taller than it is wide and taller than everything beside it. */
export const SHEET_SIZE: Size = { w: 300, h: 400 };
export const VISUAL_SIZE: Size = { w: 340, h: 230 };
/** A file card says a name and a type, so it is the smallest thing on the table. */
export const FILE_SIZE: Size = { w: 240, h: 132 };
/** A chat is a column of turns, so the card is a column too: taller than it is wide. */
export const TRANSCRIPT_SIZE: Size = { w: 300, h: 420 };
/** Portrait 2:3, which is the shape a fixed-viewport page capture comes back as. */
export const WEBCLIP_SIZE: Size = { w: 260, h: 390 };
/**
 * Landscape, because a flow chart is wider than it is tall far more often than
 * not. The diagram is fitted inside whatever the card is, so this is a starting
 * shape rather than a claim about any one diagram.
 */
export const DIAGRAM_SIZE: Size = { w: 360, h: 260 };
/**
 * How many cards a band of a folder's contents puts side by side before it wraps.
 * A topic is looked at as a shelf rather than as a column: two across turned a
 * folder of a dozen pictures into a strip taller than the screen. Six is as wide
 * as a band goes before the block runs off the side of the viewport.
 */
export const PREVIEW_COLUMNS = 6;
/** World units between one card and the next in the block a folder opens into. */
export const PREVIEW_GAP = 24;
/**
 * How wide the auto-arranged block beside a folder card is allowed to get: wide
 * enough for `PREVIEW_COLUMNS` of the widest card there is, so a band of pictures
 * fills a row rather than wrapping at three.
 */
export const PREVIEW_WIDTH = PREVIEW_COLUMNS * VISUAL_SIZE.w + (PREVIEW_COLUMNS - 1) * PREVIEW_GAP;
/** A card has to be big enough to hold a title before its own content is fetched. */
export const MIN_CARD_SIZE: Size = { w: 120, h: 64 };

/**
 * The size a picture of known pixel dimensions starts at: its own shape, with
 * its longer side as wide as the default visual card, so a wide picture, a tall
 * one and a square one all take about the room a picture is given — and none of
 * them is cropped to a shape it does not have.
 */
export function pictureCardSize(pixels: { width: number; height: number }): Size {
  const longest = Math.max(pixels.width, pixels.height);
  if (longest <= 0) return VISUAL_SIZE;
  const scale = VISUAL_SIZE.w / longest;
  return { w: Math.round(pixels.width * scale), h: Math.round(pixels.height * scale) };
}

/**
 * What every card carries. Identity and content come from the vault; `x`, `y`,
 * `w`, `h` and `z` come from the placement, and are the only part of a card that
 * is the app's own (PLAN decision 4).
 */
interface PlacedObject extends CanvasObject {
  /** The vault-relative path, which is also the object's id. */
  path: string;
  name: string;
  title: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /**
   * The sheet the card grows out of the first time it is drawn, and goes back
   * into when it leaves: it starts as that sheet — its size, its place and its
   * lean — and travels to its own rectangle as it fills out. Only a folder's
   * preview sets it, and it names the item's own sheet rather than the folder,
   * so what comes out comes out of where it was sitting. Everything else is
   * simply already where it belongs. Read once and never again: a card that kept
   * consulting it would spring back every time the board was rescanned.
   */
  from?: SheetSlot;
}

/**
 * One item inside a folder, as much of it as the folder's own card draws: enough
 * to fetch the picture it is, or to set the line it opens with. A placeholder in
 * the shape of a card says nothing a colour swatch does not.
 */
export interface FolderPeek {
  /** Vault-relative path, which is where the card reads a picture's bytes from. */
  path: string;
  kind: CardKind;
  /** What the item calls itself: its title, or its file name where it has none. */
  label: string;
}

/** A directory: a topic (PLAN §5). The one kind that can be entered. */
export interface FolderObject extends PlacedObject {
  kind: "folder";
  /** How many things are directly inside, for the card's own summary. */
  count: number;
  /**
   * Everything inside, in the order an opened folder lays it out: one sheet per
   * item, so what comes out of the folder comes out of its own sheet. A folder
   * shows what it holds the way a physical one does — by letting the paper stick
   * out — and a card drawing four of a dozen items made the gesture a lie.
   */
  peek: FolderPeek[];
  /**
   * Whether its contents are laid out beside it. They came out of the folder,
   * so while they are on the table the card draws nothing standing out of it:
   * the same items in two places would read as copies.
   */
  opened?: boolean;
}

/**
 * A short note. Nothing here says it is a sticky rather than a sheet:
 * `cardKindFor` decided that from the body alone (PLAN decision 2), and a card
 * only carries what it draws.
 */
export interface StickyObject extends PlacedObject {
  kind: "sticky";
  /** The body, already clipped by the server. */
  preview: string;
  truncated: boolean;
  /** The paper it is drawn on, from the note's own `color:`; green by default. */
  color: StickyColor;
  /**
   * Lines of the file the preview starts past — the heading drawn as the card's
   * title, and the blank line under it. A card writing back to the file adds it
   * to whatever line it is acting on.
   */
  offset: number;
}

/** A long note, drawn as a page. */
export interface SheetObject extends PlacedObject {
  kind: "sheet";
  preview: string;
  truncated: boolean;
}

/** A picture or a clip, drawn as itself. */
export interface VisualObject extends PlacedObject {
  kind: "visual";
  /** Plays itself, muted and looping, rather than showing one frame. */
  video: boolean;
}

/** A markdown file whose whole body is one url, drawn as a capture of that page. */
export interface WebclipObject extends PlacedObject {
  kind: "webclip";
  url: string;
}

/**
 * A diagram: a `.mmd`, or a note that is nothing but one mermaid fence. The card
 * carries the source rather than the drawing — the drawing is made from it in the
 * browser, and a board document that stored SVG would store a stale one.
 */
export interface DiagramObject extends PlacedObject {
  kind: "diagram";
  source: string;
}

/**
 * Anything the board cannot read: a transcript, an archive, a binary someone
 * dropped in. It is drawn as what it is — a name and a type — rather than as an
 * empty page, and it opens in whatever handles that kind instead of in the note
 * editor.
 */
export interface FileObject extends PlacedObject {
  kind: "file";
  /** Lower case and without the dot, or empty for a file that carries none. */
  extension: string;
}

/**
 * A chat: the log of one session, which the host wrote into this vault. Nothing
 * of what it says is on the card — the id is, and the live projection of that
 * session is where the title, the prompt, the reply and whether it is still
 * running come from, so a card of a running chat is never a stale one.
 */
export interface TranscriptObject extends PlacedObject {
  kind: "transcript";
  sessionId: string;
}

export type BoardObject =
  | FolderObject
  | StickyObject
  | SheetObject
  | VisualObject
  | WebclipObject
  | DiagramObject
  | FileObject
  | TranscriptObject;

/** What one item points at, what points at it, and what nearly does. */
export interface LinkSummary {
  path: string;
  /** Links written in this item's body, resolved or not. */
  outgoing: { target: string; to: string | null; ambiguous: boolean }[];
  /** Paths whose bodies link here. */
  backlinks: string[];
  /** Names this item's body says without linking — the connection nobody made. */
  suggestions: { path: string; count: number }[];
  /** Items that say this one's name without linking to it. */
  mentionedBy: { path: string; count: number }[];
}

export function linkSummary(vault: VaultSnapshot, path: string): LinkSummary {
  return {
    path,
    outgoing: vault.links
      .filter((link) => link.from === path)
      .map((link) => ({ target: link.target, to: link.to, ambiguous: link.ambiguous })),
    backlinks: vault.backlinks[path] ?? [],
    suggestions: vault.mentions
      .filter((mention) => mention.source === path)
      .map((mention) => ({ path: mention.target, count: mention.count })),
    mentionedBy: vault.mentions
      .filter((mention) => mention.target === path)
      .map((mention) => ({ path: mention.source, count: mention.count })),
  };
}

export interface BoardViewInput {
  vault: VaultSnapshot;
  /**
   * Items to leave off the board as if the vault did not hold them. A stored
   * position for one is dropped like any other position whose path is gone.
   */
  omit?: (item: VaultSnapshotItem) => boolean;
  /** Only this board's slice of the stored map, by path. */
  placements: Record<string, Placement>;
  /** The directory this board shows; `""` is the vault root. */
  board: string;
  size?: (item: VaultSnapshotItem) => Size;
  slot?: SlotChooser;
  /** The piles this board had. One whose members are all gone does not come back. */
  stacks?: StackMap;
}

export interface BoardView {
  objects: BoardObject[];
  /**
   * The map to store: positions carried over, new ones added, and the ones for
   * paths that are gone dropped. Nothing else in the document is touched.
   */
  placements: Record<string, Placement>;
  /** The piles that still hold something. */
  stacks: StackMap;
  added: string[];
  removed: string[];
  carried: string[];
}

export function boardView(input: BoardViewInput): BoardView {
  const omit = input.omit ?? (() => false);
  const byPath = new Map(
    input.vault.items.filter((item) => !omit(item)).map((item) => [item.path, item]),
  );
  const entries = shownPaths(byPath, input.board, input.placements).map((path) => {
    const item = byPath.get(path);
    return {
      path,
      id: item?.id ?? null,
      size: sizeFor(item, input.size),
    };
  });

  const options: ReconcileOptions = { size: STICKY_SIZE };
  if (input.slot !== undefined) options.slot = input.slot;
  if (input.stacks !== undefined) options.stacks = input.stacks;
  const reconciled = reconcileBoard(entries, input.placements, options);

  const objects: BoardObject[] = [];
  for (const entry of entries) {
    const item = byPath.get(entry.path);
    if (!item) continue;
    const placement = reconciled.placements[entry.path];
    if (!placement) continue;
    objects.push(objectFor(item, placement, byPath));
  }
  // Drawing order is `z`, so a pile's cascade stacks the way it was folded and
  // the card on top is the one that answers a click.
  objects.sort((left, right) => left.z - right.z);

  return {
    objects,
    placements: reconciled.placements,
    stacks: reconciled.stacks,
    added: reconciled.added,
    removed: reconciled.removed,
    carried: reconciled.carried,
  };
}

/**
 * The order an opened folder lays its contents out in. Spatial does not flow a
 * topic's contents in name order — it groups them by what they are, so the block
 * reads as pictures, then paper, then notes. The containers lead because they are
 * what a topic holds more of itself, and the unreadable ones trail because they
 * are the least to look at.
 *
 * An order and not a set of rows: the block is packed, so a kind starts wherever
 * the one before it left room rather than on a line of its own.
 */
export const PREVIEW_BANDS: readonly CardKind[] = [
  "folder",
  "visual",
  "diagram",
  "webclip",
  "transcript",
  "sheet",
  "sticky",
  "file",
];

/**
 * How far sideways each card moves while something on the board is open, by id.
 * The region the board parts around is `around` — the folder, or the pile before
 * it was spread — together with the `block` its contents now cover: the folder
 * stays where it is while its contents are out, so a card pushed clear of the
 * block alone would be pushed onto the folder instead of off it. `except` names
 * what is being opened and what came out of it. Nothing is written: the cards go
 * back when the thing closes.
 *
 * Two rules, and between them they are the whole function:
 *
 * - A card the region does not reach vertically stays exactly where it is. The
 *   board used to give way at every height, so a card two screens below a folder
 *   slid sideways to make room for something it could never have touched.
 * - Every card the region does reach, on one side of it, moves by the same
 *   amount: as far as the worst-covered of them needs. Moving each by its own
 *   overlap sounds better and is not — the neighbour gives up more ground than
 *   the card behind it and is shoved straight into it, so a parting meant to
 *   open a gap closes a different one.
 *
 * A side the block never reaches still gives way, by `PART_SHARE` of what the
 * other side gave. A folder that opens to its right and leaves everything to its
 * left standing reads as a block landing on the board rather than as the board
 * making room, and the small move is what says the two are the same gesture.
 *
 * Which way a card goes is which side of the region's middle it started on, so a
 * card the block lands on top of leaves by the nearer edge.
 */
/** What a side the block never reaches gives up, as a share of what the other did. */
const PART_SHARE = 0.3;

export function pushAside(
  cards: readonly BoardObject[],
  around: Rect,
  block: readonly Rect[],
  except: ReadonlySet<string>,
  gap: number,
): ReadonlyMap<string, number> {
  const shifts = new Map<string, number>();
  if (block.length === 0) return shifts;
  const region = [around, ...block];
  const left = Math.min(...region.map((rect) => rect.x)) - gap;
  const right = Math.max(...region.map((rect) => rect.x + rect.w)) + gap;
  const top = Math.min(...region.map((rect) => rect.y)) - gap;
  const bottom = Math.max(...region.map((rect) => rect.y + rect.h)) + gap;
  const middle = (left + right) / 2;

  const parting: BoardObject[] = [];
  let leftNeed = 0;
  let rightNeed = 0;
  for (const card of cards) {
    if (except.has(card.id)) continue;
    if (card.y >= bottom || card.y + card.h <= top) continue;
    parting.push(card);
    if (card.x + card.w / 2 < middle) leftNeed = Math.max(leftNeed, card.x + card.w - left);
    else rightNeed = Math.max(rightNeed, right - card.x);
  }

  const leftBy = Math.max(leftNeed, rightNeed * PART_SHARE);
  const rightBy = Math.max(rightNeed, leftNeed * PART_SHARE);
  for (const card of parting) {
    const shift = card.x + card.w / 2 < middle ? -leftBy : rightBy;
    if (shift !== 0) shifts.set(card.id, Math.round(shift));
  }
  return shifts;
}

/**
 * The topic's own contents, laid out by the app with no stored positions: this is
 * what a single click shows (PLAN §6). The block starts at `origin` and wraps at
 * `maxWidth`, so the caller decides where beside the topic card it goes.
 *
 * Nothing here consults placements: a preview ignores where things sit on their
 * own board, because it is showing the collection, not the arrangement.
 */
export function previewObjects(
  vault: VaultSnapshot,
  topicPath: string,
  options: {
    origin: { x: number; y: number };
    maxWidth?: number;
    /** How big each card is, so a previewed sheet is a page and not a note stub. */
    size?: (item: VaultSnapshotItem) => Size;
    /**
     * The folder's own rectangle. Each card in the block grows out of the sheet
     * it was drawn on inside that rectangle, which is what makes the gesture read
     * as the folder being emptied rather than as a second board appearing beside
     * it — and what lets the same travel, run backwards, put it away.
     */
    from?: { x: number; y: number; w: number; h: number };
  },
): BoardObject[] {
  const byPath = new Map(vault.items.map((item) => [item.path, item]));
  const contents = [...byPath.values()].filter((item) => item.dir === topicPath);
  if (contents.length === 0) return [];

  const ordered = orderByBand(contents);
  const folder = options.from;
  const sheets = folder ? folderSheets(ordered.length, folder.w, folder.h) : null;

  // Cards of one kind share a size, so the block is allowed `PREVIEW_COLUMNS` of
  // the widest card there is. Wrapping on `maxWidth` alone let a collection of
  // narrow file cards run ten across and off the side of the viewport.
  const columns = Math.min(PREVIEW_COLUMNS, ordered.length);
  const widest = Math.max(...ordered.map((item) => (sizeFor(item, options.size) ?? STICKY_SIZE).w));
  const slot = packSlot({
    maxWidth: Math.min(
      options.maxWidth ?? PREVIEW_WIDTH,
      columns * widest + (columns - 1) * PREVIEW_GAP,
    ),
    gap: PREVIEW_GAP,
  });

  const occupied: Rect[] = [];
  const objects: BoardObject[] = [];
  ordered.forEach((item, index) => {
    const card = sizeFor(item, options.size) ?? STICKY_SIZE;
    const spot = slot(occupied, card);
    occupied.push({ ...spot, ...card });

    const placement: Placement = {
      x: spot.x + options.origin.x,
      y: spot.y + options.origin.y,
      ...card,
      z: 1,
    };
    const object = objectFor(item, placement, byPath);
    const sheet = sheets?.[index];
    if (folder && sheet) object.from = { ...sheet, x: folder.x + sheet.x, y: folder.y + sheet.y };
    objects.push(object);
  });

  return objects;
}

/**
 * The order an opened folder lays its contents out in, and the order they sit in
 * the folder itself. The bands are an order and not rows of their own: a block
 * cut into a row per kind is as deep as the tallest card in each of them, which
 * is the empty table under the notes in the reference block that Spatial does not
 * have. Packed instead, every card drops onto what is already there, so the kinds
 * still read in order and a short card lets the next one rise beside it.
 */
function orderByBand(items: readonly VaultSnapshotItem[]): VaultSnapshotItem[] {
  return PREVIEW_BANDS.flatMap((kind) => items.filter((item) => cardKindFor(item) === kind));
}

/**
 * What this board shows: its own directory's entries, plus anything placed here
 * from elsewhere. A stored position for a path the vault no longer has is left to
 * `reconcileBoard` to report as removed.
 */
function shownPaths(
  byPath: ReadonlyMap<string, VaultSnapshotItem>,
  board: string,
  placements: Record<string, Placement>,
): string[] {
  const paths = new Set<string>();

  for (const item of byPath.values()) {
    if (item.dir === board) paths.add(item.path);
  }
  for (const path of Object.keys(placements)) {
    if (byPath.has(path)) paths.add(path);
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

function objectFor(
  item: VaultSnapshotItem,
  placement: Placement,
  byPath: ReadonlyMap<string, VaultSnapshotItem>,
): BoardObject {
  // A note names itself with its opening heading far more often than with a
  // `title:`, and the heading has to come off the body once it is the card's
  // headline or it is drawn a second time as the first line of the prose.
  const heading = headingTitle(item.preview);
  const shared = {
    id: item.path,
    path: item.path,
    name: item.name,
    title: item.title ?? heading.title,
    x: placement.x,
    y: placement.y,
    w: placement.w,
    h: placement.h,
    z: placement.z,
  };
  // A note named by its frontmatter keeps its body whole; one named by its own
  // opening heading has that heading drawn as the card's title instead, and the
  // lines it cost are what a write back to the file has to step over.
  const namedByHeading = item.title === null;
  const note = {
    ...shared,
    preview: namedByHeading ? heading.body : item.preview,
    truncated: item.truncated,
    offset: namedByHeading ? heading.offset : 0,
  };

  // What an item is drawn as comes from its own content (PLAN decision 2), so the
  // card kind is derived here and never read off the board document.
  switch (cardKindFor(item)) {
    case "folder": {
      const inside: VaultSnapshotItem[] = [];
      for (const other of byPath.values()) {
        if (other.dir === item.path) inside.push(other);
      }
      // In the order the folder opens into, so sheet and card are the same item:
      // the block beside an opened folder is laid out in this order too, and the
      // card that comes out of the third sheet is the third one in the block.
      const peek = orderByBand(inside).map(peekOf);
      // A folder is one size, whatever its placement says: the card is a
      // silhouette, and a silhouette stretched to a stored size stops reading
      // as a folder.
      return {
        kind: "folder",
        ...shared,
        w: FOLDER_SIZE.w,
        h: FOLDER_SIZE.h,
        count: inside.length,
        peek,
      };
    }
    case "visual":
      return { kind: "visual", ...shared, video: isVideoPath(item.path) };
    case "webclip":
      return { kind: "webclip", ...shared, url: urlBody(item.preview) ?? item.preview.trim() };
    case "diagram":
      return { kind: "diagram", ...shared, source: diagramSource(item.path, item.preview) ?? "" };
    case "file":
      return { kind: "file", ...shared, extension: extensionOf(item.path) };
    case "transcript":
      return { kind: "transcript", ...shared, sessionId: sessionIdOf(item.path) };
    case "sticky":
      return { kind: "sticky", ...note, color: stickyColor(item.color) };
    case "sheet":
      return { kind: "sheet", ...note };
  }
}

/**
 * What the folder's card needs of one item inside it. The label is what the item
 * itself would put at the top of its card, so a folder of notes reads as those
 * notes rather than as three grey rectangles.
 */
function peekOf(item: VaultSnapshotItem): FolderPeek {
  return {
    path: item.path,
    kind: cardKindFor(item),
    label: item.title ?? headingTitle(item.preview).title ?? item.name,
  };
}

function sizeFor(
  item: VaultSnapshotItem | undefined,
  size: ((item: VaultSnapshotItem) => Size) | undefined,
): Size | undefined {
  if (item === undefined || size === undefined) return undefined;
  const chosen = size(item);
  return {
    w: Math.max(MIN_CARD_SIZE.w, chosen.w),
    h: Math.max(MIN_CARD_SIZE.h, chosen.h),
  };
}

/**
 * The board document is hand-editable and outlives the build that wrote it, so a
 * card that will not parse is dropped rather than drawn wrong. A card with no
 * usable size gets the default instead of disappearing: the item is real even when
 * its placement is not.
 */
export function parseFolder(raw: unknown): FolderObject | null {
  const placed = parsePlaced(raw, "folder");
  if (!placed) return null;

  // An empty peek is a real state — a folder with nothing in it — rather than a
  // fallback, so it is where the card starts and the document only adds to it.
  const folder: FolderObject = {
    kind: "folder",
    ...placed,
    count: readNumber(raw, "count", 0),
    peek: [],
  };
  if (readBoolean(raw, "opened")) folder.opened = true;

  const peek = isRecord(raw) ? raw["peek"] : null;
  if (Array.isArray(peek))
    folder.peek = peek.map(parsePeek).filter((entry): entry is FolderPeek => entry !== null);
  return folder;
}

const CARD_KINDS = new Set<string>([
  "folder",
  "sticky",
  "sheet",
  "visual",
  "webclip",
  "diagram",
  "file",
  "transcript",
]);

function isCardKind(value: unknown): value is CardKind {
  return typeof value === "string" && CARD_KINDS.has(value);
}

/**
 * An entry written by a build whose folders peeked at kinds alone is dropped: it
 * names no file, so there is nothing of the item left to draw. The scan rebuilds
 * the folder's card on the next pass anyway.
 */
function parsePeek(raw: unknown): FolderPeek | null {
  if (!isRecord(raw)) return null;
  const kind = raw["kind"];
  const path = raw["path"];
  if (!isCardKind(kind) || typeof path !== "string" || path.length === 0) return null;
  const label = raw["label"];
  return { path, kind, label: typeof label === "string" ? label : path };
}

export function parseSticky(raw: unknown): StickyObject | null {
  const placed = parsePlaced(raw, "sticky");
  if (!placed) return null;

  return {
    kind: "sticky",
    ...placed,
    preview: readString(raw, "preview"),
    truncated: readBoolean(raw, "truncated"),
    color: stickyColor(readString(raw, "color")),
    offset: readNumber(raw, "offset", 0),
  };
}

export function parseSheet(raw: unknown): SheetObject | null {
  const placed = parsePlaced(raw, "sheet");
  if (!placed) return null;

  return {
    kind: "sheet",
    ...placed,
    preview: readString(raw, "preview"),
    truncated: readBoolean(raw, "truncated"),
  };
}

export function parseVisual(raw: unknown): VisualObject | null {
  const placed = parsePlaced(raw, "visual");
  if (!placed) return null;
  return { kind: "visual", ...placed, video: readBoolean(raw, "video") };
}

export function parseFile(raw: unknown): FileObject | null {
  const placed = parsePlaced(raw, "file");
  if (!placed) return null;
  return { kind: "file", ...placed, extension: readString(raw, "extension") };
}

export function parseTranscript(raw: unknown): TranscriptObject | null {
  const placed = parsePlaced(raw, "transcript");
  if (!placed) return null;

  const sessionId = readString(raw, "sessionId");
  // Without the session there is no chat to draw, only a file name — and a file
  // name is what the plain file card already says.
  if (sessionId.length === 0) return null;
  return { kind: "transcript", ...placed, sessionId };
}

export function parseDiagram(raw: unknown): DiagramObject | null {
  const placed = parsePlaced(raw, "diagram");
  if (!placed) return null;
  return { kind: "diagram", ...placed, source: readString(raw, "source") };
}

export function parseWebclip(raw: unknown): WebclipObject | null {
  const placed = parsePlaced(raw, "webclip");
  if (!placed) return null;

  const url = readString(raw, "url");
  if (url.length === 0) return null;
  return { kind: "webclip", ...placed, url };
}

interface PlacedFields {
  id: string;
  path: string;
  name: string;
  title: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  from?: SheetSlot;
}

function parsePlaced(raw: unknown, kind: string): PlacedFields | null {
  if (!isRecord(raw)) return null;
  if (raw["kind"] !== kind) return null;

  const id = readString(raw, "id");
  const path = readString(raw, "path");
  const title = readString(raw, "title");
  const x = raw["x"];
  const y = raw["y"];
  if (id.length === 0 || path.length === 0) return null;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;

  const fields: PlacedFields = {
    id,
    path,
    name: readString(raw, "name"),
    title: title.length > 0 ? title : null,
    x,
    y,
    w: Math.max(MIN_CARD_SIZE.w, readNumber(raw, "w", STICKY_SIZE.w)),
    h: Math.max(MIN_CARD_SIZE.h, readNumber(raw, "h", STICKY_SIZE.h)),
    z: readNumber(raw, "z", 0),
  };

  const from = raw["from"];
  if (
    isRecord(from) &&
    isFiniteNumber(from["x"]) &&
    isFiniteNumber(from["y"]) &&
    isFiniteNumber(from["w"]) &&
    isFiniteNumber(from["h"])
  )
    fields.from = {
      x: from["x"],
      y: from["y"],
      w: from["w"],
      h: from["h"],
      lean: isFiniteNumber(from["lean"]) ? from["lean"] : 0,
      index: readNumber(from, "index", 0),
      total: readNumber(from, "total", 1),
    };
  return fields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readString(raw: unknown, key: string): string {
  if (!isRecord(raw)) return "";
  const value = raw[key];
  if (typeof value !== "string") return "";
  return value;
}

function readNumber(raw: unknown, key: string, fallback: number): number {
  if (!isRecord(raw)) return fallback;
  const value = raw[key];
  return isFiniteNumber(value) ? value : fallback;
}

function readBoolean(raw: unknown, key: string): boolean {
  return isRecord(raw) && raw[key] === true;
}
