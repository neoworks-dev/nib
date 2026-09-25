/**
 * Where a ComfyUI run's result goes on the board, and how it stays tied to what
 * it was made from. The spot is chosen when the run is queued, so the board can
 * hold it with a placeholder while the run goes; the outputs are placed into it
 * once they are in the vault, and linked to the pictures the run was given.
 */

import {
  COMFY_LINEAGE_KIND,
  type ComfyLineageObject,
  type ComfyResultSlot,
  type ComfyRun,
  type Point,
} from "@nib-ui/ui-contracts";
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
/** Rows above and below a requested point searched for the nearest free spot. */
const NEAR_ROWS = 3;

/**
 * The spot on the board the outputs land on, at the reference picture's size,
 * clear of every card and of the spots `reserved` for runs still going: at `at`
 * when the run was asked for at a point, else beside the reference. With
 * neither, the board's next free flow slot.
 */
export function resultSlot(
  placements: PlacementMap,
  outputDirectory: string,
  reference: string | null,
  reserved: readonly ComfyResultSlot[],
  at: Point | null = null,
): ComfyResultSlot {
  const board = cleanVaultPath(outputDirectory);
  const onBoard = Object.values(placementsFor(placements, board));
  const held = reserved.filter((slot) => slot.board === board);
  const occupied: Rect[] = [...onBoard, ...held];
  const anchor = referencePlacement(placements, board, reference);
  let size = DEFAULT_RESULT_SIZE;
  if (anchor) size = { w: anchor.w, h: anchor.h };
  const clear = clearSpot(anchor, at, size, occupied);
  if (clear) return { board, ...clear };
  const spot = flowSlot()(occupied, size);
  return { board, ...spot, ...size };
}

/**
 * A free spot near where the result was asked for, or in the reference's row to
 * its right; null when neither is given or nothing near is free.
 */
function clearSpot(
  anchor: Rect | null,
  at: Point | null,
  size: Size,
  occupied: readonly Rect[],
): Rect | null {
  if (at) return nearestClear({ x: at.x, y: at.y, ...size }, occupied);
  if (!anchor) return null;
  return firstClearFrom({ x: anchor.x + anchor.w + SLOT_GAP, y: anchor.y, ...size }, occupied);
}

/**
 * The free spot closest to `start`, searching its row and the rows above and
 * below it rightwards: a point in a crowded row should not send the result
 * across the whole board.
 */
function nearestClear(start: Rect, occupied: readonly Rect[]): Rect | null {
  let best: Rect | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const row of rowsOutward()) {
    const rowStart = { ...start, y: start.y + row * (start.h + SLOT_GAP) };
    const clear = firstClearFrom(rowStart, occupied);
    if (!clear) continue;
    const distance = Math.hypot(clear.x - start.x, clear.y - start.y);
    if (distance >= bestDistance) continue;
    best = clear;
    bestDistance = distance;
  }
  return best;
}

/** Row offsets from the start outwards, below before above, so a tie lands below. */
function rowsOutward(): number[] {
  const rows = [0];
  for (let distance = 1; distance <= NEAR_ROWS; distance += 1) rows.push(distance, -distance);
  return rows;
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

/**
 * A link from every picture the run was given to every output it wrote. The id
 * is made from the run and the pair, so linking the same run twice adds nothing.
 */
export function lineageObjects(run: ComfyRun, outputs: readonly string[]): ComfyLineageObject[] {
  const links: ComfyLineageObject[] = [];
  for (const from of run.inputs) {
    for (const to of outputs) {
      links.push({
        kind: COMFY_LINEAGE_KIND,
        id: `comfy-lineage:${run.id}:${from}:${to}`,
        from,
        to,
      });
    }
  }
  return links;
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

/** The first spot from `start` rightwards, at its size, that overlaps nothing; null if none is near. */
function firstClearFrom(start: Rect, occupied: readonly Rect[]): Rect | null {
  const candidate: Rect = { ...start };
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const blocker = occupied.find((other) => overlaps(candidate, other));
    if (!blocker) return candidate;
    candidate.x = blocker.x + blocker.w + SLOT_GAP;
  }
  return null;
}
