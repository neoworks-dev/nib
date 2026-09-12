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
import { cardKindFor } from "./card-kind";
import {
  type Placement,
  type ReconcileOptions,
  type Size,
  type SlotChooser,
  type VaultSnapshot,
  type VaultSnapshotItem,
  flowSlot,
  reconcileBoard,
} from "@nib-ui/vault";

export const TOPIC_SIZE: Size = { w: 288, h: 168 };
export const FILE_SIZE: Size = { w: 288, h: 132 };
/** A page, so it is taller than it is wide and taller than everything beside it. */
export const SHEET_SIZE: Size = { w: 300, h: 400 };
/** How wide the auto-arranged block beside a topic card is allowed to get. */
export const PREVIEW_WIDTH = 640;
/** A card has to be big enough to hold a title before its own content is fetched. */
export const MIN_CARD_SIZE: Size = { w: 120, h: 64 };

export interface TopicObject extends CanvasObject {
  kind: "topic";
  /** The vault-relative directory path, and the object's id. */
  path: string;
  name: string;
  title: string | null;
  /** How many things are directly inside, for the card's own summary. */
  count: number;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface FileObject extends CanvasObject {
  kind: "file";
  path: string;
  name: string;
  /** Lowercase, without the dot. Empty for a file with no extension. */
  extension: string;
  title: string | null;
  /** The body, already clipped by the server, for a note card to draw. */
  preview: string;
  truncated: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

/**
 * A long note, drawn as a page. Nothing here says it is a sheet: `cardKindFor`
 * decided that from the body alone, and the card only carries what it draws.
 */
export interface SheetObject extends CanvasObject {
  kind: "sheet";
  path: string;
  name: string;
  title: string | null;
  /** The body, already clipped by the server, for the page to draw. */
  preview: string;
  truncated: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export type BoardObject = TopicObject | FileObject | SheetObject;

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
}

export interface BoardView {
  objects: BoardObject[];
  /**
   * The map to store: positions carried over, new ones added, and the ones for
   * paths that are gone dropped. Nothing else in the document is touched.
   */
  placements: Record<string, Placement>;
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

  const options: ReconcileOptions = { size: FILE_SIZE };
  if (input.slot !== undefined) options.slot = input.slot;
  const reconciled = reconcileBoard(entries, input.placements, options);

  const objects: BoardObject[] = [];
  for (const entry of entries) {
    const item = byPath.get(entry.path);
    if (!item) continue;
    const placement = reconciled.placements[entry.path];
    if (!placement) continue;
    objects.push(objectFor(item, placement, byPath));
  }

  return {
    objects,
    placements: reconciled.placements,
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
  options: { origin: { x: number; y: number }; maxWidth?: number; size?: Size },
): BoardObject[] {
  const byPath = new Map(vault.items.map((item) => [item.path, item]));
  const contents = [...byPath.values()].filter((item) => item.dir === topicPath);
  const slot = flowSlot({ maxWidth: options.maxWidth ?? PREVIEW_WIDTH });
  const size = options.size ?? FILE_SIZE;

  const occupied: { x: number; y: number; w: number; h: number }[] = [];
  const objects: BoardObject[] = [];

  for (const item of contents) {
    const card = sizeFor(item, undefined) ?? size;
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

  if (item.kind === "topic") {
    let count = 0;
    for (const other of byPath.values()) {
      if (other.dir === item.path) count += 1;
    }
    return { kind: "topic", ...shared, count };
  }

  // What a note is drawn as comes from its own content (PLAN decision 2), so the
  // card kind is derived here and never read off the board document.
  if (cardKindFor(item) === "sheet") {
    return { kind: "sheet", ...shared, preview: item.preview, truncated: item.truncated };
  }

  return {
    kind: "file",
    ...shared,
    extension: extensionOf(item.path),
    preview: item.preview,
    truncated: item.truncated,
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

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * The board document is hand-editable and outlives the build that wrote it, so a
 * card that will not parse is dropped rather than drawn wrong. A card with no
 * usable size gets the default instead of disappearing: the item is real even when
 * its placement is not.
 */
export function parseTopic(raw: unknown): TopicObject | null {
  const placed = parsePlaced(raw, "topic");
  if (!placed) return null;
  return { kind: "topic", ...placed, count: readNumber(raw, "count", 0) };
}

export function parseFile(raw: unknown): FileObject | null {
  const placed = parsePlaced(raw, "file");
  if (!placed) return null;

  return {
    kind: "file",
    ...placed,
    extension: readString(raw, "extension"),
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
    w: Math.max(MIN_CARD_SIZE.w, readNumber(raw, "w", FILE_SIZE.w)),
    h: Math.max(MIN_CARD_SIZE.h, readNumber(raw, "h", FILE_SIZE.h)),
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
