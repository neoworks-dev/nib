/**
 * What a card does while something is being dropped on it, and what the dropped
 * card does on the way in. Both are capabilities rather than kinds: the tool
 * knows a drag is over something, and the kind knows whether that means anything.
 */

import type { CanvasObjectRenderer, Rect } from "@nib-ui/ui-contracts";

/**
 * A card a drop lands in. Only a kind that does something with what is let go on
 * it says so — a folder takes the file, and every other card would simply leave
 * it where the drag put it, so outlining one promises a move that never happens.
 */
export interface DropTargetRenderer {
  acceptsDrop(): boolean;
}

export function isDropTarget(
  renderer: CanvasObjectRenderer | undefined,
): renderer is CanvasObjectRenderer & DropTargetRenderer {
  return typeof (renderer as Partial<DropTargetRenderer> | undefined)?.acceptsDrop === "function";
}

/**
 * A card being dragged, told what it is over. It shrinks towards the size of the
 * thing that would take it, so the size says where it is going before it is let
 * go, and on release it is drawn into it.
 */
export interface DropSourceRenderer {
  /** The rectangle the card is over, or null once it is over nothing. */
  previewDrop(target: Rect | null): void;
  /** Let go over `target`: the card goes in rather than fading where it was. */
  swallowInto(target: Rect): void;
}

export function isDropSource(
  renderer: CanvasObjectRenderer | undefined,
): renderer is CanvasObjectRenderer & DropSourceRenderer {
  return typeof (renderer as Partial<DropSourceRenderer> | undefined)?.previewDrop === "function";
}
