/**
 * The plus button hung off a card's edge. Dragging it out onto the table is
 * how a task is started from what the card is: a picture, a clip, a file. It
 * shows for the edge the pointer is near — near from outside, not over the
 * card, so a picture being looked at grows no chrome — and only that edge.
 *
 * The button is outside the card, so the card's own hit test never sees it;
 * the tool asks the renderer instead, the way it asks about resize handles.
 * Pure geometry, so drawing and grabbing cannot disagree.
 */

import type { CanvasObjectRenderer, Point, Rect } from "@nib-ui/ui-contracts";
import type { Graphics } from "pixi.js";

export type SpawnEdge = "n" | "e" | "s" | "w";

/** Screen pixels, converted to world units against the camera at draw time. */
export const PLUS = {
  radius: 9,
  /** From the card's edge to the button's centre. */
  gap: 16,
  /** How far outside the button a press still grabs it. */
  reach: 6,
  /** How far outside the card the pointer may be for the button to show. */
  near: 44,
  fill: 0xffffff,
  ring: 0x9aa0a8,
  glyph: 0x262626,
} as const;

/**
 * Opted into by a renderer whose object can be dragged out into a new task.
 * `canSpawn` lets one class serve every card while only some kinds offer it.
 */
export interface SpawnableRenderer {
  canSpawn(): boolean;
  /** The button under a world point, or null when the point is not on the shown one. */
  plusAt(worldX: number, worldY: number): SpawnEdge | null;
  /** Shows the button on `edge`, lit when the pointer is on it; null hides it. */
  hoverPlus(edge: SpawnEdge | null, hot: boolean): void;
}

export function isSpawnable(
  renderer: CanvasObjectRenderer | undefined,
): renderer is CanvasObjectRenderer & SpawnableRenderer {
  const candidate = renderer as Partial<SpawnableRenderer> | undefined;
  return typeof candidate?.plusAt === "function" && candidate.canSpawn?.() === true;
}

/** World units for a screen size, capped so the chrome never outgrows the card. */
function scaled(pixels: number, zoom: number, shortest: number): number {
  return Math.min(pixels / Math.max(0.2, zoom), shortest / 4);
}

/** How far a coordinate is past a span of `size` starting at zero; zero inside it. */
function overhang(value: number, size: number): number {
  if (value < 0) return -value;
  if (value > size) return value - size;
  return 0;
}

/**
 * The edge a card-local point is near from outside, or null over the card or
 * further out than `near`. Beyond a corner, the edge the point is closer to.
 */
export function nearEdge(
  localX: number,
  localY: number,
  width: number,
  height: number,
  zoom: number,
): SpawnEdge | null {
  const outsideX = overhang(localX, width);
  const outsideY = overhang(localY, height);
  if (outsideX === 0 && outsideY === 0) return null;

  const reach = PLUS.near / Math.max(0.2, zoom);
  if (outsideX > reach || outsideY > reach) return null;

  const besideASide = outsideY === 0 || (outsideX > 0 && outsideX < outsideY);
  if (besideASide) return localX < 0 ? "w" : "e";
  return localY < 0 ? "n" : "s";
}

/** The button's centre in card-local coordinates, one past the edge's midpoint. */
export function plusPoint(
  edge: SpawnEdge,
  width: number,
  height: number,
  zoom: number,
): { x: number; y: number } {
  const gap = scaled(PLUS.gap, zoom, Math.max(1, Math.min(width, height)));
  switch (edge) {
    case "n":
      return { x: width / 2, y: -gap };
    case "e":
      return { x: width + gap, y: height / 2 };
    case "s":
      return { x: width / 2, y: height + gap };
    case "w":
      return { x: -gap, y: height / 2 };
  }
}

/** Whether a card-local point is on the button shown at `edge`. */
export function onPlus(
  localX: number,
  localY: number,
  edge: SpawnEdge,
  width: number,
  height: number,
  zoom: number,
): boolean {
  const shortest = Math.max(1, Math.min(width, height));
  const grab = scaled(PLUS.radius + PLUS.reach, zoom, shortest);
  const point = plusPoint(edge, width, height, zoom);
  return Math.hypot(localX - point.x, localY - point.y) <= grab;
}

/** The world point a drag from `edge` starts at: the button's own centre. */
export function plusAnchor(bounds: Rect, edge: SpawnEdge, zoom: number): Point {
  const point = plusPoint(edge, bounds.width, bounds.height, zoom);
  return { x: bounds.x + point.x, y: bounds.y + point.y };
}

/** A white disc with a grey ring and a plus in it; solid while aimed at. */
export function drawPlusButton(
  graphics: Graphics,
  width: number,
  height: number,
  zoom: number,
  edge: SpawnEdge | null,
  hot: boolean,
): void {
  graphics.clear();
  if (edge === null) return;

  const shortest = Math.max(1, Math.min(width, height));
  const radius = scaled(PLUS.radius, zoom, shortest);
  const stroke = Math.max(0.5, radius / 9);
  const arm = radius * 0.5;
  const point = plusPoint(edge, width, height, zoom);

  graphics.circle(point.x, point.y, radius);
  graphics.fill({ color: PLUS.fill, alpha: hot ? 1 : 0.92 });
  graphics.circle(point.x, point.y, radius);
  graphics.stroke({ width: stroke, color: PLUS.ring, alpha: hot ? 1 : 0.7 });
  graphics.moveTo(point.x - arm, point.y).lineTo(point.x + arm, point.y);
  graphics.moveTo(point.x, point.y - arm).lineTo(point.x, point.y + arm);
  graphics.stroke({ width: stroke * 1.4, color: PLUS.glyph, alpha: hot ? 1 : 0.8 });
}
