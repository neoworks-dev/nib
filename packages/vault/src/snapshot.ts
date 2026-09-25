/**
 * The vault as it travels to a client. A snapshot is a plain value — no Maps, no
 * file bodies — so a board can be rendered from it and the same shape can be
 * compared, cached or journalled.
 *
 * It is deliberately not the whole vault: an item's body is carried only as far as
 * a card could show it, and the quadratic derived data is opt-in.
 */

import type { RawLink } from "./links";
import type { VaultEntryKind, VaultIndex, VaultItem, VaultLink, VaultMention } from "./tree";

/** Roughly what a note card can draw before the rest is a click away. */
export const DEFAULT_PREVIEW_CHARS = 2_000;

export interface VaultSnapshotItem {
  path: string;
  kind: VaultEntryKind;
  /** The directory holding it, `""` at the vault root: which board it belongs to. */
  dir: string;
  name: string;
  id: string | null;
  title: string | null;
  /**
   * What the item asked to be drawn in, from its own `color:`. A name rather than
   * a value — the board owns the palette — and null for the vast majority of
   * items, which never declare one.
   */
  color: string | null;
  /** The body with code blanked, clipped to `previewChars`. */
  preview: string;
  /** The body was longer than the preview, so a card can offer to open it. */
  truncated: boolean;
  /** Link targets as written, so a card can say what an item points at. */
  links: RawLink[];
}

export interface VaultSnapshot {
  items: VaultSnapshotItem[];
  links: VaultLink[];
  /** Target path to the paths linking to it. Empty for an item nothing points at. */
  backlinks: Record<string, string[]>;
  /** Names a link asked for that nothing answers to. */
  unresolved: string[];
  mentions: VaultMention[];
}

export interface SnapshotOptions {
  previewChars?: number;
  /** Quadratic in the number of items, so a caller opts in rather than paying by default. */
  mentions?: readonly VaultMention[];
}

/**
 * The snapshot plus what the server knows about the vault it came from. `writable`
 * is false when the vault could not be created, which is the one case where an
 * empty board means something other than an empty project.
 */
export interface VaultDoc extends VaultSnapshot {
  cwd: string;
  writable: boolean;
  reason: string | null;
}

export function toSnapshot(index: VaultIndex, options: SnapshotOptions = {}): VaultSnapshot {
  const limit = options.previewChars ?? DEFAULT_PREVIEW_CHARS;

  return {
    items: index.items.map((item) => itemSnapshot(item, limit)),
    links: index.links,
    backlinks: Object.fromEntries(index.backlinks),
    unresolved: index.unresolved,
    mentions: [...(options.mentions ?? [])],
  };
}

function itemSnapshot(item: VaultItem, limit: number): VaultSnapshotItem {
  const text = item.text.trim();
  const clipped = text.slice(0, limit);

  return {
    path: item.path,
    kind: item.kind,
    dir: item.dir,
    name: item.name,
    id: item.id,
    title: item.title,
    color: item.color,
    preview: clipped,
    truncated: text.length > clipped.length,
    links: item.links,
  };
}
