/**
 * The recycling bin: where a deleted entry waits instead of being unlinked.
 *
 * Deleting from a board is a pointer gesture, and a gesture has to be reversible
 * — a confirm box only moves the risk to a click the user has already learned to
 * dismiss. So a delete is a move into `.nib/.trash`, which makes it undoable by
 * the same stack that undoes a drag, and recoverable after a reload by the bin.
 *
 * The directory is dotted and skipped by the scan, so nothing in it is ever drawn
 * as a card: a deleted note must not come back as a topic called `.trash`.
 */

export const TRASH_DIRECTORY = ".trash";

/** What each deleted entry is filed under, beside the entry itself. */
export const TRASH_META_FILE = "meta.json";

export interface TrashEntry {
  /** Names the deletion, not the file: two deletes of one path are two entries. */
  id: string;
  /** Where it was, so restoring it is a move home rather than a guess. */
  path: string;
  name: string;
  /** A topic takes its contents with it, and comes back with them. */
  kind: "file" | "topic";
  /** Epoch milliseconds, for ordering the bin newest first. */
  deletedAt: number;
}

/**
 * Sortable and unique: the timestamp orders the bin without reading any metadata,
 * and the suffix keeps two deletions in the same millisecond apart.
 */
export function trashEntryId(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** True for a path inside the bin, which no board gesture may address. */
export function isTrashPath(path: string): boolean {
  return path === TRASH_DIRECTORY || path.startsWith(`${TRASH_DIRECTORY}/`);
}

/** The bin's own listing order: newest first, which is where an undo looks. */
export function sortTrash(entries: readonly TrashEntry[]): TrashEntry[] {
  return [...entries].sort((left, right) => right.deletedAt - left.deletedAt);
}
