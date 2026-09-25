/**
 * Where a ComfyUI run's result goes on the board. The spot is chosen when the
 * run is queued, so the board can hold it with a placeholder while the run goes,
 * and the outputs are placed into it once they are in the vault.
 */

import type { ComfyResultSlot } from "@nib-ui/ui-contracts";
import {
  flowSlot,
  overlaps,
  type PlacementMap,
  placementsFor,
  type Rect,
  type Size,
} from "@nib-ui/vault";
import type { PlacementWrite } from "./board-store";
import { cleanVaultPath } from "./vault-write";

/** World units between a reference card and its result, and between results in a row. */
const SLOT_GAP = 32;
/** The size a result starts at when there is no reference card to match. */
const DEFAULT_RESULT_SIZE: Size = { w: 340, h: 340 };
/** How far the search walks right of the reference before settling for the flow. */
const MAX_STEPS = 64;

/**
 * The spot beside the reference picture on the board the outputs land on, at the
 * reference's own size, clear of every card and of the spots `reserved` for runs
 * still going. Without a placed reference, the board's next free flow slot.
 */
export function resultSlot(
  placements: PlacementMap,
  outputDirectory: string,
  reference: string | null,
  reserved: readonly ComfyResultSlot[],
): ComfyResultSlot {
  const board = cleanVaultPath(outputDirectory);
  const onBoard = Object.values(placementsFor(placements, board));
  const held = reserved.filter((slot) => slot.board === board);
  const occupied: Rect[] = [...onBoard, ...held];
  const anchor = referencePlacement(placements, board, reference);
  let size = DEFAULT_RESULT_SIZE;
  if (anchor) {
    const beside = besideAnchor(anchor, occupied);
    if (beside) return { board, ...beside };
    size = { w: anchor.w, h: anchor.h };
  }
  const spot = flowSlot()(occupied, size);
  return { board, ...spot, ...size };
}

/** Placements for a finished run's outputs: the first in its slot, the rest in a row to its right. */
export function slotPlacements(slot: ComfyResultSlot, paths: readonly string[]): PlacementWrite[] {
  return paths.map((path, index) => ({
    path,
    x: slot.x + index * (slot.w + SLOT_GAP),
    y: slot.y,
    w: slot.w,
    h: slot.h,
  }));
}

/** The reference's rectangle, when it sits on the board the outputs land on. */
function referencePlacement(
  placements: PlacementMap,
  board: string,
  reference: string | null,
): Rect | null {
  if (reference === null) return null;
  const placement = placementsFor(placements, board)[reference];
  if (!placement) return null;
  return placement;
}

/** The first spot right of the anchor, at its size, that overlaps nothing; null if none is near. */
function besideAnchor(anchor: Rect, occupied: readonly Rect[]): Rect | null {
  const candidate: Rect = {
    x: anchor.x + anchor.w + SLOT_GAP,
    y: anchor.y,
    w: anchor.w,
    h: anchor.h,
  };
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const blocker = occupied.find((other) => overlaps(candidate, other));
    if (!blocker) return candidate;
    candidate.x = blocker.x + blocker.w + SLOT_GAP;
  }
  return null;
}
