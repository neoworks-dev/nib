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
 * The free spot closest to `start`, a gap clear of every card. The closest spot
 * always sits at `start` or a gap off some card's edge on each axis, so those
 * are the only places tried; on a tie, below wins, then right.
 */
function nearestClear(start: Rect, occupied: readonly Rect[]): Rect | null {
  const xs = edgeCandidates(start.x, start.w, occupied, "x", "w");
  const ys = edgeCandidates(start.y, start.h, occupied, "y", "h");
  let best: Rect | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const x of xs) {
    for (const y of ys) {
      const candidate = { x, y, w: start.w, h: start.h };
      const score = placementScore(start, candidate);
      if (score >= bestScore || !keepsGap(candidate, occupied)) continue;
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** Positions on one axis: the start, and a gap before and after each card. */
function edgeCandidates(
  start: number,
  size: number,
  occupied: readonly Rect[],
  position: "x" | "y",
  extent: "w" | "h",
): number[] {
  const candidates = [start];
  for (const rect of occupied) {
    candidates.push(rect[position] + rect[extent] + SLOT_GAP, rect[position] - size - SLOT_GAP);
  }
  return candidates;
}

/**
 * How far a candidate is from the start, lowest best. A hair's preference for
 * below, then right, decides between spots that are equally far.
 */
function placementScore(start: Rect, candidate: Rect): number {
  const distance = Math.hypot(candidate.x - start.x, candidate.y - start.y);
  let tieBreak = 0;
  if (candidate.y < start.y) tieBreak += 0.002;
  if (candidate.x < start.x) tieBreak += 0.001;
  return distance + tieBreak;
}

/** Whether a spot stays at least a gap away from every card. */
function keepsGap(candidate: Rect, occupied: readonly Rect[]): boolean {
  // A hair under the gap, so a spot placed exactly a gap off an edge still fits.
  const margin = SLOT_GAP - 0.5;
  const padded = {
    x: candidate.x - margin,
    y: candidate.y - margin,
    w: candidate.w + margin * 2,
    h: candidate.h + margin * 2,
  };
  return !occupied.some((other) => overlaps(padded, other));
}

/** An output written into the vault, with its size in pixels when it is known. */
export interface PlacedOutput {
  path: string;
  pixels: { width: number; height: number } | null;
}

/**
 * Placements for a finished run's outputs: the first in its slot, the rest in a
 * row to its right. Each keeps its own shape, fitted inside the slot's box, so a
 * tall picture from a wide source is not cropped; one of unknown size fills it.
 */
export function slotPlacements(
  slot: ComfyResultSlot,
  outputs: readonly PlacedOutput[],
): PlacementWrite[] {
  const placements: PlacementWrite[] = [];
  let x = slot.x;
  for (const output of outputs) {
    const size = fitInside(slot, output.pixels);
    placements.push({ path: output.path, x, y: slot.y, w: size.w, h: size.h });
    x += size.w + SLOT_GAP;
  }
  return placements;
}

/** The largest size of the picture's shape that fits the slot, or the slot itself for an unknown shape. */
function fitInside(slot: Size, pixels: PlacedOutput["pixels"]): Size {
  if (!pixels) return { w: slot.w, h: slot.h };
  const scale = Math.min(slot.w / pixels.width, slot.h / pixels.height);
  return { w: Math.round(pixels.width * scale), h: Math.round(pixels.height * scale) };
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
