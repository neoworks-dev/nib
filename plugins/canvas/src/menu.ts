/**
 * What can be done with what was right-clicked. One list, built once: the board
 * used to answer the same question in three places — a bar beside a single card,
 * a bar docked at the bottom for a group, and a menu with a third set of entries
 * — and the three drifted apart.
 *
 * Pure: handed the board's state and a set of callbacks, so what appears for a
 * selection can be checked without a renderer, a vault or a kernel.
 */

import type { CanvasMenuItem, CanvasObject, Point } from "@nib-ui/ui-contracts";
import type { Component } from "svelte";
import { STICKY_COLORS, STICKY_PALETTE, type StickyColor } from "./theme";
import { isWorkstream } from "./workstream";

export type MenuIcon = Component<{ size?: number }>;

/**
 * Handed in rather than imported: phosphor ships its icons as Svelte components,
 * and importing one here would make this module unloadable outside a bundler.
 */
export interface BoardMenuIcons {
  dissolve: MenuIcon;
  collapse: MenuIcon;
  arrange: MenuIcon;
  join: MenuIcon;
  group: MenuIcon;
  preview: MenuIcon;
  enter: MenuIcon;
  open: MenuIcon;
  start: MenuIcon;
  unlink: MenuIcon;
  trash: MenuIcon;
  note: MenuIcon;
  paste: MenuIcon;
}

/** The kinds the vault contributes. Everything else was put there by a plugin. */
const VAULT_CARD_KINDS = new Set([
  "folder",
  "sticky",
  "sheet",
  "visual",
  "webclip",
  "file",
  "transcript",
]);

export function isVaultCard(kind: string): boolean {
  return VAULT_CARD_KINDS.has(kind);
}

export interface BoardMenuActions {
  dissolveStack(stack: string): void;
  collapse(): void;
  arrange(): void;
  join(): void;
  /** Moves them into a topic of their own, which is a directory on disk. */
  group(ids: string[]): void;
  paint(ids: string[], color: StickyColor): void;
  preview(id: string): void;
  enter(id: string): void;
  open(id: string): void;
  startWorkstream(ids: string[], at: Point): void;
  unlink(ids: string[]): void;
  /** Into the recycling bin, which is what deleting a vault item means. */
  erase(ids: string[]): void;
  /** Off the board, leaving whatever it stood for alone. */
  remove(ids: string[]): void;
}

export interface BoardMenu {
  selection: string[];
  objects: CanvasObject[];
  icons: BoardMenuIcons;
  stackOf(id: string): string | null;
  canUnlink(id: string): boolean;
  /** True for an object a workstream can carry as context. */
  carries(object: CanvasObject): boolean;
  actions: BoardMenuActions;
}

/**
 * Right-clicking a card that is part of the selection acts on the whole of it;
 * right-clicking anything else acts on that card alone. Without this the menu
 * would silently act on a selection the pointer is nowhere near.
 */
export function menuTargets(target: CanvasObject, selection: string[]): string[] {
  if (selection.length > 1 && selection.includes(target.id)) return [...selection];
  return [target.id];
}

function action(id: string, label: string, icon: MenuIcon, run: () => void): CanvasMenuItem {
  return { kind: "action", id, label, icon, run };
}

/** What the right button offers over empty table, where there is nothing to act on. */
export interface BackdropMenuActions {
  writeNote(at: Point): void;
  paste(at: Point): void;
}

/**
 * The menu for empty board space: what can be made here, rather than what can be
 * done to something. Every entry lands at the point that was clicked, which is
 * the whole reason the board answers the right button at all — the palette makes
 * the same things, but only the pointer says where.
 *
 * Starting a workstream is not among them: the composer is docked at the foot of
 * the pane, so the board has one input rather than one the pointer has to find.
 */
export function backdropMenuItems(
  at: Point,
  icons: BoardMenuIcons,
  actions: BackdropMenuActions,
): CanvasMenuItem[] {
  return [
    action("canvas.backdrop.note", "Write a note here", icons.note, () => actions.writeNote(at)),
    { kind: "separator", id: "canvas.backdrop.pasteSep" },
    action("canvas.backdrop.paste", "Paste here", icons.paste, () => actions.paste(at)),
  ];
}

/** The pile every acted-on card is in, or null when they are not all in one. */
function sharedStack(ids: string[], board: BoardMenu): string | null {
  const first = board.stackOf(ids[0] ?? "");
  if (first === null) return null;
  return ids.every((id) => board.stackOf(id) === first) ? first : null;
}

export function boardMenuItems(
  target: CanvasObject,
  at: Point,
  board: BoardMenu,
): CanvasMenuItem[] {
  const ids = menuTargets(target, board.selection);
  const cards = board.objects.filter((object) => ids.includes(object.id));
  const count = ids.length;
  const items: CanvasMenuItem[] = [];

  // Piling and arranging are about where things sit, so they come first and
  // nothing above the last separator touches the filesystem.
  const stack = sharedStack(ids, board);
  if (stack !== null) {
    items.push(
      action("canvas.stack.dissolve", "Take this stack apart", board.icons.dissolve, () =>
        board.actions.dissolveStack(stack),
      ),
    );
  } else if (count > 1) {
    items.push(
      action("canvas.stack.collapse", `Collapse ${count} into a stack`, board.icons.collapse, () =>
        board.actions.collapse(),
      ),
    );
    items.push(
      action("canvas.arrange.grid", `Arrange ${count} into a grid`, board.icons.arrange, () =>
        board.actions.arrange(),
      ),
    );
    items.push(
      action("canvas.join", `Join ${count} into one workstream`, board.icons.join, () =>
        board.actions.join(),
      ),
    );
  }

  // Only what the vault holds can go into a topic: a directory is made of files,
  // and a card a plugin put on the board has none to move.
  const vault = cards.filter((card) => isVaultCard(card.kind));
  if (count > 1 && vault.length === count) {
    items.push({ kind: "separator", id: "canvas.groupSep" });
    items.push(
      action("canvas.vault.group", `Put ${count} into a topic`, board.icons.group, () =>
        board.actions.group(ids),
      ),
    );
  }

  // The colour goes in the note's own frontmatter, so there is nothing to paint
  // on a picture or a folder.
  if (cards.length === count && cards.every((card) => card.kind === "sticky")) {
    if (items.length > 0) items.push({ kind: "separator", id: "canvas.paintSep" });
    items.push({
      kind: "swatches",
      id: "canvas.paint",
      swatches: STICKY_PALETTE.map((color) => ({
        id: color,
        label: `Write this on ${color} paper`,
        css: STICKY_COLORS[color].css,
      })),
      run: (swatchId) => {
        const color = STICKY_PALETTE.find((entry) => entry === swatchId);
        if (color) board.actions.paint(ids, color);
      },
    });
  }

  if (count === 1 && target.kind === "folder") {
    if (items.length > 0) items.push({ kind: "separator", id: "canvas.folderSep" });
    items.push(
      action("canvas.vault.preview", "Show what is inside", board.icons.preview, () =>
        board.actions.preview(target.id),
      ),
    );
    items.push(
      action("canvas.vault.enter", "Open this topic", board.icons.enter, () =>
        board.actions.enter(target.id),
      ),
    );
  }

  if (count === 1 && isWorkstream(target)) {
    items.push(
      action("canvas.open", "Open transcript", board.icons.open, () =>
        board.actions.open(target.id),
      ),
    );
  }

  // Anything a plugin put there — a picture, a model, a bookmark — is worth a
  // task of its own, and travels to it as a file.
  const carryable = cards.filter((card) => !isVaultCard(card.kind) && board.carries(card));
  if (count > 0 && carryable.length === count) {
    items.push(
      action(
        "canvas.startFromObject",
        count > 1 ? `Start a workstream from ${count}` : "Start a workstream from this",
        board.icons.start,
        () => board.actions.startWorkstream(ids, at),
      ),
    );
  }

  if (items.length > 0) items.push({ kind: "separator", id: "canvas.removeSep" });

  // Unlinking leaves the file alone, so it is offered only where there is a
  // placement to drop; an item in this board's own directory is here because it
  // is in the directory, and taking it off would mean deleting it.
  if (ids.every((id) => board.canUnlink(id))) {
    items.push(
      action(
        "canvas.vault.unlink",
        count > 1 ? `Unlink ${count} from this board` : "Unlink from this board",
        board.icons.unlink,
        () => board.actions.unlink(ids),
      ),
    );
  }

  // A mixed selection is taken off the board rather than deleted: one gesture
  // must not mean two different things to the files behind it.
  if (count > 0 && vault.length === count) {
    items.push({
      kind: "action",
      id: "canvas.vault.delete",
      label: deleteLabel(target, count),
      icon: board.icons.trash,
      danger: true,
      run: () => board.actions.erase(ids),
    });
    return items;
  }

  items.push({
    kind: "action",
    id: "canvas.deleteObject",
    label: count > 1 ? `Remove ${count} from the board` : "Remove from board",
    icon: board.icons.trash,
    danger: true,
    run: () => board.actions.remove(ids),
  });
  return items;
}

function deleteLabel(target: CanvasObject, count: number): string {
  if (count > 1) return `Delete ${count} items`;
  if (target.kind === "folder") return "Delete this topic";
  return "Delete this file";
}
