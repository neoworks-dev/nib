/**
 * Alignment guides: where a dragged card lines up with the cards already on the
 * table. Every candidate is read off the placed objects — their edges and their
 * centres — so the board has no grid and nothing to configure: what a card
 * aligns to is whatever is already there.
 *
 * Two things are offered, and only two. An edge lines up with the same edge on a
 * neighbour — a left with a left, a top with a top — and a card brought up
 * beside one keeps a gap of `SNAP_GAP` from it. Centres are not offered at all,
 * and matching every anchor against every other used to mean a left edge could
 * be caught by a centre: the board pulled at all times, so the position the user
 * chose was never the one they got.
 *
 * Pure geometry, so the line that is drawn and the offset that is applied cannot
 * disagree, and the whole thing is testable without a renderer.
 */

import type { Rect } from "@nib-ui/ui-contracts";
import { CARD_GAP } from "../theme";

/** A vertical guide is an `x`, a horizontal one a `y`. */
export type SnapAxis = "x" | "y";

/** The gutter a drag keeps from a neighbour. The board's own, not the snap's. */
export const SNAP_GAP = CARD_GAP;

export interface SnapGuide {
  axis: SnapAxis;
  /** An anchor shared with neighbours, or the gap kept from one. */
  kind: "align" | "gap";
  /** World x for a vertical guide, world y for a horizontal one. */
  position: number;
  /** Along the guide: the span it covers, in world units. */
  from: number;
  to: number;
}

export interface SnapResult {
  /** Added to the drag's own offset; zero on the axis that found no alignment. */
  x: number;
  y: number;
  guides: SnapGuide[];
}

interface Span {
  start: number;
  size: number;
}

interface Candidate {
  kind: "align" | "gap";
  offset: number;
  /** Where the line goes: the shared anchor, or the middle of the kept gap. */
  position: number;
  /** The neighbour a gap is kept from; empty for an alignment, which finds its own. */
  neighbour: Rect | null;
}

/** Two coordinates count as the same alignment within this many world units. */
const EPSILON = 0.01;

function span(rect: Rect, axis: SnapAxis): Span {
  if (axis === "x") return { start: rect.x, size: rect.width };
  return { start: rect.y, size: rect.height };
}

/** The two edges of a span: left and right, or top and bottom. */
function anchors(span: Span): [number, number] {
  return [span.start, span.start + span.size];
}

function overlaps(one: Span, other: Span): boolean {
  return one.start < other.start + other.size && other.start < one.start + one.size;
}

/**
 * The nearest thing the drag can be held by on one axis. A gap wins a tie with an
 * alignment: it is what the board arranges by, so it is what a card brought up
 * alongside another was aiming at.
 */
function bestCandidate(
  moving: Rect,
  neighbours: readonly Rect[],
  tolerance: number,
  axis: SnapAxis,
): Candidate | null {
  const cross = axis === "x" ? "y" : "x";
  const movingSpan = span(moving, axis);
  const movingAnchors = anchors(movingSpan);
  const movingCross = span(moving, cross);
  let best: Candidate | null = null;

  const consider = (candidate: Candidate): void => {
    if (Math.abs(candidate.offset) > tolerance) return;
    if (!best) {
      best = candidate;
      return;
    }
    const distance = Math.abs(candidate.offset);
    const held = Math.abs(best.offset);
    if (distance < held - EPSILON) {
      best = candidate;
      return;
    }
    if (distance <= held + EPSILON && candidate.kind === "gap" && best.kind === "align") {
      best = candidate;
    }
  };

  const [movingStart, movingEnd] = movingAnchors;
  for (const neighbour of neighbours) {
    // Like for like: a left edge is caught by a left edge, a right by a right.
    const [start, end] = anchors(span(neighbour, axis));
    consider({ kind: "align", offset: start - movingStart, position: start, neighbour: null });
    consider({ kind: "align", offset: end - movingEnd, position: end, neighbour: null });

    // A gap is only a gap between two cards that are actually beside each other.
    if (!overlaps(movingCross, span(neighbour, cross))) continue;
    const neighbourSpan = span(neighbour, axis);
    const after = neighbourSpan.start + neighbourSpan.size + SNAP_GAP;
    const before = neighbourSpan.start - SNAP_GAP - movingSpan.size;
    consider({
      kind: "gap",
      offset: after - movingSpan.start,
      position: neighbourSpan.start + neighbourSpan.size + SNAP_GAP / 2,
      neighbour,
    });
    consider({
      kind: "gap",
      offset: before - movingSpan.start,
      position: neighbourSpan.start - SNAP_GAP / 2,
      neighbour,
    });
  }
  return best;
}

/**
 * The line for a candidate, in the coordinates the card ends up at. An alignment
 * runs across every card holding it; a gap is a tick in the space it keeps, so it
 * spans only where the two cards face each other.
 */
function guideFor(
  candidate: Candidate,
  snapped: Rect,
  neighbours: readonly Rect[],
  axis: SnapAxis,
): SnapGuide {
  const cross = axis === "x" ? "y" : "x";

  if (candidate.kind === "gap" && candidate.neighbour) {
    const moving = span(snapped, cross);
    const beside = span(candidate.neighbour, cross);
    return {
      axis,
      kind: "gap",
      position: candidate.position,
      from: Math.max(moving.start, beside.start),
      to: Math.min(moving.start + moving.size, beside.start + beside.size),
    };
  }

  const holding = neighbours.filter((neighbour) =>
    anchors(span(neighbour, axis)).some(
      (anchor) => Math.abs(anchor - candidate.position) < EPSILON,
    ),
  );
  const spans = [snapped, ...holding].map((rect) => span(rect, cross));
  return {
    axis,
    kind: "align",
    position: candidate.position,
    from: Math.min(...spans.map((one) => one.start)),
    to: Math.max(...spans.map((one) => one.start + one.size)),
  };
}

/**
 * Where a dragged rectangle wants to sit, given what is already placed. The
 * offset is what the caller adds to the position it was going to write, and the
 * guides are the lines to draw for it — one per axis at most.
 *
 * `tolerance` is in world units, so the caller divides screen pixels by the zoom:
 * the pull has to feel the same however far out the board is.
 */
export function snapToNeighbours(
  moving: Rect,
  neighbours: readonly Rect[],
  tolerance: number,
): SnapResult {
  const vertical = bestCandidate(moving, neighbours, tolerance, "x");
  const horizontal = bestCandidate(moving, neighbours, tolerance, "y");

  // The lines are drawn through where the card ends up, not where the pointer put
  // it: a guide measured off the unsnapped rectangle is short by the pull itself.
  const snapped = {
    ...moving,
    x: moving.x + (vertical?.offset ?? 0),
    y: moving.y + (horizontal?.offset ?? 0),
  };

  const guides: SnapGuide[] = [];
  if (vertical) guides.push(guideFor(vertical, snapped, neighbours, "x"));
  if (horizontal) guides.push(guideFor(horizontal, snapped, neighbours, "y"));

  return { x: snapped.x - moving.x, y: snapped.y - moving.y, guides };
}
