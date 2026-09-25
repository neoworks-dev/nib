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

import type { Point } from "@nib-ui/ui-contracts";
import type { Placement, Rect, StackMap } from "@nib-ui/vault";
import { CARD_GAP } from "./theme";

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

/**
 * Where a folded pile sits: the footprint of the card on top of it, which is the
 * rectangle `collapse` gave the pile and the one a drag of the pile carries. The
 * members come as `membersOf` answers them, bottom of the pile first.
 *
 * Read from the cards rather than from the stored rectangle because a drag moves
 * placements and nothing else: a pile that has been moved and then opened used to
 * spread around where it no longer was.
 */
export function pileRect(members: readonly StackMember[]): Rect | null {
  const top = members.at(-1);
  if (!top) return null;
  return { x: top.placement.x, y: top.placement.y, w: top.placement.w, h: top.placement.h };
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
 * Folds a selection into a pile at the centre of what it covered, largest card at
 * the back and smallest on top, so every card shows an edge and none is buried
 * under a bigger one.
 *
 * Ordered by size rather than by where the pointer was: the pile is folded, spread
 * to be looked through and folded again, and an order read off the cursor or off
 * the spread layout gave a different pile every time. Size is the one thing the
 * cards carry through all of it, so the pile comes back as the pile that was left.
 *
 * Each layer steps up and to the left of the one above it, so the card on top is
 * fully visible and the ones under it show only as edges.
 *
 * `at` is where the pile lands, and a pile that is being folded back up passes the
 * one it already has: the middle of what the cards cover is the middle of a spread
 * block by then, not the middle of the pile they came out of, so folding without it
 * walked the pile a little further off every time it was opened and closed.
 */
export function collapse(
  members: readonly StackMember[],
  stack: string,
  at?: Point,
): CollapseResult | null {
  if (members.length < 2) return null;

  const covered = boundsOf(members.map((member) => member.placement));
  if (!covered) return null;

  // Largest first, so it ends up deepest; the path breaks a tie, because two cards
  // of one size must not swap places from one fold to the next.
  const ordered = [...members].sort(
    (left, right) =>
      areaOf(right.placement) - areaOf(left.placement) || left.path.localeCompare(right.path),
  );
  const top = ordered.at(-1);
  if (!top) return null;

  const center = at ?? { x: covered.x + covered.w / 2, y: covered.y + covered.h / 2 };
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

/**
 * Cards dragged out of their piles. A member let go where it no longer touches
 * any other member of its pile has left it; one dropped back onto the pile is
 * still in it. A pile left with one card is no pile — one card in a stack is
 * just a card — so it is taken apart with the leaver.
 */
export function release(
  placements: Readonly<Record<string, Placement>>,
  stacks: StackMap,
  ids: readonly string[],
): { placements: Record<string, Placement>; stacks: StackMap } {
  let next: Record<string, Placement> = { ...placements };
  let remaining: StackMap = { ...stacks };

  for (const id of ids) {
    const placement = next[id];
    const stack = placement?.stack;
    if (!placement || stack === undefined) continue;
    const others = membersOf(next, stack).filter((member) => member.path !== id);
    if (others.some((member) => overlaps(placement, member.placement))) continue;
    const { stack: _left, ...rest } = placement;
    next[id] = rest;
    if (others.length >= 2) continue;
    const taken = dissolve(next, remaining, stack);
    next = taken.placements;
    remaining = taken.stacks;
  }
  return { placements: next, stacks: remaining };
}

/** World units between cards laid out as a grid: the board's own gutter. */
export const GRID_GAP = CARD_GAP;

/**
 * The selection laid out in columns, as many columns as rows or one more, in
 * reading order of where the cards were: the one nearest the top left leads, so
 * the arrangement keeps whatever order it already had. It starts at the top left
 * of what the selection covered.
 *
 * Columns rather than rows, because a vault holds cards of very different
 * heights. Rows advance by their tallest card, so one long note drags a band of
 * empty table under every short card beside it. Each card instead goes to
 * whichever column currently reaches least far down, which is what makes the
 * gaps read as even — the same masonry Pinterest lays out.
 *
 * Every column is one gap apart and as wide as the widest card in that column, so
 * the left edges line up as a grid does and a narrow card leaves its slack on its
 * own right. Sizing every column to the widest card on the board instead is what
 * put two narrow cards a gap plus somebody else's slack apart.
 */
export function arrangeGrid(
  members: readonly StackMember[],
  gap = GRID_GAP,
): Record<string, Placement> {
  if (members.length === 0) return {};

  const columns = Math.ceil(Math.sqrt(members.length));
  const band = Math.max(...members.map((member) => member.placement.h)) + gap;
  // Cards within a band of each other are one row, read left to right.
  const row = (member: StackMember): number => Math.floor(member.placement.y / band);
  const ordered = [...members].sort(
    (left, right) => row(left) - row(right) || left.placement.x - right.placement.x,
  );
  const bounds = boundsOf(ordered.map((member) => member.placement));
  if (!bounds) return {};

  const bottoms = new Array<number>(columns).fill(bounds.y);
  const packed: { member: StackMember; column: number; top: number }[] = [];
  for (const member of ordered) {
    let column = 0;
    let top = bounds.y;
    for (const [index, bottom] of bottoms.entries()) {
      if (index > 0 && bottom >= top) continue;
      column = index;
      top = bottom;
    }

    packed.push({ member, column, top });
    bottoms[column] = top + member.placement.h + gap;
  }

  // Each column starts a gap after the widest card in the one before it. A column
  // nothing landed in takes no room, so it opens no gap either.
  const placements: Record<string, Placement> = {};
  let left = bounds.x;
  for (const [index] of bottoms.entries()) {
    const inColumn = packed.filter((entry) => entry.column === index);
    if (inColumn.length === 0) continue;
    for (const entry of inColumn) {
      placements[entry.member.path] = {
        ...entry.member.placement,
        x: Math.round(left),
        y: Math.round(entry.top),
      };
    }
    left += Math.max(...inColumn.map((entry) => entry.member.placement.w)) + gap;
  }
  return placements;
}

function overlaps(left: Placement, right: Placement): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

function areaOf(placement: Placement): number {
  return placement.w * placement.h;
}
