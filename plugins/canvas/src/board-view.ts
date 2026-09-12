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
import { cardKindFor, isVideoPath, urlBody } from "./card-kind";
import {
  type Placement,
  type ReconcileOptions,
  type Size,
  type SlotChooser,
  type StackMap,
  type VaultSnapshot,
  type VaultSnapshotItem,
  flowSlot,
  reconcileBoard,
} from "@nib-ui/vault";

/** A folder is the widest card and the shortest, because it holds nothing itself. */
export const FOLDER_SIZE: Size = { w: 288, h: 168 };
/** The small one: a sticky is about 85% the width of the sheet beside it. */
export const STICKY_SIZE: Size = { w: 256, h: 300 };
/** A page, so it is taller than it is wide and taller than everything beside it. */
export const SHEET_SIZE: Size = { w: 300, h: 400 };
export const VISUAL_SIZE: Size = { w: 340, h: 230 };
/** Portrait 2:3, which is the shape a fixed-viewport page capture comes back as. */
export const WEBCLIP_SIZE: Size = { w: 260, h: 390 };
/** How wide the auto-arranged block beside a folder card is allowed to get. */
export const PREVIEW_WIDTH = 640;
/** A card has to be big enough to hold a title before its own content is fetched. */
export const MIN_CARD_SIZE: Size = { w: 120, h: 64 };

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
}

/** A directory: a topic (PLAN §5). The one kind that can be entered. */
export interface FolderObject extends PlacedObject {
  kind: "folder";
  /** How many things are directly inside, for the card's own summary. */
  count: number;
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

export type BoardObject = FolderObject | StickyObject | SheetObject | VisualObject | WebclipObject;

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
  const byPath = new Map(input.vault.items.map((item) => [item.path, item]));
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
  },
): BoardObject[] {
  const byPath = new Map(vault.items.map((item) => [item.path, item]));
  const contents = [...byPath.values()].filter((item) => item.dir === topicPath);
  const slot = flowSlot({ maxWidth: options.maxWidth ?? PREVIEW_WIDTH });

  const occupied: { x: number; y: number; w: number; h: number }[] = [];
  const objects: BoardObject[] = [];

  for (const item of contents) {
    const card = sizeFor(item, options.size) ?? STICKY_SIZE;
    const spot = slot(occupied, card);
    const placement: Placement = {
      x: spot.x + options.origin.x,
      y: spot.y + options.origin.y,
      ...card,
      z: 1,
    };
    occupied.push({ x: spot.x, y: spot.y, ...card });
    objects.push(objectFor(item, placement, byPath));
  }

  return objects;
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
  const shared = {
    id: item.path,
    path: item.path,
    name: item.name,
    title: item.title,
    x: placement.x,
    y: placement.y,
    w: placement.w,
    h: placement.h,
    z: placement.z,
  };

  // What an item is drawn as comes from its own content (PLAN decision 2), so the
  // card kind is derived here and never read off the board document.
  switch (cardKindFor(item)) {
    case "folder": {
      let count = 0;
      for (const other of byPath.values()) {
        if (other.dir === item.path) count += 1;
      }
      return { kind: "folder", ...shared, count };
    }
    case "visual":
      return { kind: "visual", ...shared, video: isVideoPath(item.path) };
    case "webclip":
      return { kind: "webclip", ...shared, url: urlBody(item.preview) ?? item.preview.trim() };
    case "sticky":
      return { kind: "sticky", ...shared, preview: item.preview, truncated: item.truncated };
    case "sheet":
      return { kind: "sheet", ...shared, preview: item.preview, truncated: item.truncated };
  }
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
  return { kind: "folder", ...placed, count: readNumber(raw, "count", 0) };
}

export function parseSticky(raw: unknown): StickyObject | null {
  const placed = parsePlaced(raw, "sticky");
  if (!placed) return null;

  return {
    kind: "sticky",
    ...placed,
    preview: readString(raw, "preview"),
    truncated: readBoolean(raw, "truncated"),
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

  return {
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
