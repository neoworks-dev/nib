/**
 * Piles. A stack is decoration and nothing else: never a directory, never a file,
 * and never anything on disk. It is a name a few placements share plus a rectangle
 * saying where the pile sits, so losing one costs an arrangement and no content.
 *
 * A pile has no card of its own to draw. Its members keep their own renderers and
 * are simply positioned into a cascade — which is what Spatial's piles are, down
 * to the axis-aligned up-left offset per layer and the absence of any badge,
 * label or count.
 *
 * Pure: no Pixi, no reactivity.
 */

import type { Placement, Rect, StackMap } from "@nib-ui/vault";

/** World units each layer of a pile steps up and to the left. */
export const CASCADE_STEP = 7;
/** How many layers still shift; below that the pile would fan out rather than pile. */
export const CASCADE_LIMIT = 5;
/** World units between cards when a pile is spread out to be looked through. */
export const SPREAD_GAP = 20;

export interface StackMember {
  path: string;
  placement: Placement;
}

let counter = 0;

export function createStackId(): string {
  counter += 1;
  return `stack:${Date.now().toString(36)}:${counter.toString(36)}`;
}

/** The paths in a pile, in the order they are stored — bottom of the pile first. */
export function membersOf(
  placements: Readonly<Record<string, Placement>>,
  stack: string,
): StackMember[] {
  return Object.entries(placements)
    .filter(([, placement]) => placement.stack === stack)
    .map(([path, placement]) => ({ path, placement }))
    .sort((left, right) => left.placement.z - right.placement.z);
}

/** Every pile that has a member on this board, by id. */
export function stacksIn(placements: Readonly<Record<string, Placement>>): Set<string> {
  const stacks = new Set<string>();
  for (const placement of Object.values(placements)) {
    if (placement.stack !== undefined) stacks.add(placement.stack);
  }
  return stacks;
}

/** The box a set of placements covers, or null for none of them. */
export function boundsOf(placements: readonly Placement[]): Rect | null {
  if (placements.length === 0) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const placement of placements) {
    left = Math.min(left, placement.x);
    top = Math.min(top, placement.y);
    right = Math.max(right, placement.x + placement.w);
    bottom = Math.max(bottom, placement.y + placement.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export interface CollapseResult {
  /** The member placements, moved into the cascade and re-ordered. */
  placements: Record<string, Placement>;
  /** Where the pile sits: the footprint of its top card. */
  rect: Rect;
}

/**
 * Folds a selection into a pile at the centre of what it covered. The member
 * nearest the cursor ends up on top, because that is the one the user was
 * looking at when they asked for the pile.
 *
 * Each layer steps up and to the left of the one above it, so the card on top is
 * fully visible and the ones under it show only as edges.
 */
export function collapse(
  members: readonly StackMember[],
  stack: string,
  cursor: { x: number; y: number },
): CollapseResult | null {
  if (members.length < 2) return null;

  const covered = boundsOf(members.map((member) => member.placement));
  if (!covered) return null;

  // Furthest from the cursor first, so the nearest ends up last and on top.
  const ordered = [...members].sort(
    (left, right) => distanceTo(right.placement, cursor) - distanceTo(left.placement, cursor),
  );
  const top = ordered.at(-1);
  if (!top) return null;

  const center = { x: covered.x + covered.w / 2, y: covered.y + covered.h / 2 };
  const rect: Rect = {
    x: Math.round(center.x - top.placement.w / 2),
    y: Math.round(center.y - top.placement.h / 2),
    w: top.placement.w,
    h: top.placement.h,
  };

  const placements: Record<string, Placement> = {};
  ordered.forEach((member, index) => {
    // Counted from the top down, so the topmost card sits exactly on the pile's
    // own rectangle and everything under it steps away from the viewer.
    const depth = Math.min(ordered.length - 1 - index, CASCADE_LIMIT);
    placements[member.path] = {
      ...member.placement,
      x: rect.x - depth * CASCADE_STEP,
      y: rect.y - depth * CASCADE_STEP,
      z: index + 1,
      stack,
    };
  });

  return { placements, rect };
}

/**
 * Opens a pile out into a loose grid around where it sits, which is what a click
 * on one does. Reflowed rather than restored: the positions the cards had before
 * they were piled are gone, and Spatial spreads them into a fresh arrangement too.
 *
 * Membership is untouched — a spread pile is still a pile, and clicking away
 * puts it back.
 */
export function spread(members: readonly StackMember[], rect: Rect): Record<string, Placement> {
  if (members.length === 0) return {};

  const columns = Math.max(1, Math.ceil(Math.sqrt(members.length)));
  const cellWidth = Math.max(...members.map((member) => member.placement.w)) + SPREAD_GAP;
  const cellHeight = Math.max(...members.map((member) => member.placement.h)) + SPREAD_GAP;
  const rows = Math.ceil(members.length / columns);

  // Centred on the pile, so the cards open outwards from where it was rather
  // than growing off to one side of it.
  const originX = rect.x + rect.w / 2 - (columns * cellWidth - SPREAD_GAP) / 2;
  const originY = rect.y + rect.h / 2 - (rows * cellHeight - SPREAD_GAP) / 2;

  const placements: Record<string, Placement> = {};
  members.forEach((member, index) => {
    placements[member.path] = {
      ...member.placement,
      x: Math.round(originX + (index % columns) * cellWidth),
      y: Math.round(originY + Math.floor(index / columns) * cellHeight),
      z: index + 1,
    };
  });
  return placements;
}

/**
 * Takes the pile apart. The cards keep wherever they are: dissolving is about
 * the grouping, and moving them as well would be two changes dressed as one.
 */
export function dissolve(
  placements: Readonly<Record<string, Placement>>,
  stacks: StackMap,
  stack: string,
): { placements: Record<string, Placement>; stacks: StackMap } {
  const next: Record<string, Placement> = {};
  for (const [path, placement] of Object.entries(placements)) {
    if (placement.stack !== stack) {
      next[path] = placement;
      continue;
    }
    const { stack: _dropped, ...rest } = placement;
    next[path] = rest;
  }

  const remaining = { ...stacks };
  delete remaining[stack];
  return { placements: next, stacks: remaining };
}

function distanceTo(placement: Placement, point: { x: number; y: number }): number {
  return Math.hypot(
    placement.x + placement.w / 2 - point.x,
    placement.y + placement.h / 2 - point.y,
  );
}
