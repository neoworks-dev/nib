import type { CanvasObjectRenderer, Point } from "@nib-ui/ui-contracts";
import type { Graphics } from "pixi.js";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

/** Screen pixels, converted to world units against the camera at draw time. */
const RADIUS = 4.5;
const INSET = 12;
const REACH = 13;
const FADE = 90;

/**
 * Opted into by any renderer whose object can be dragged bigger. The select tool
 * asks the renderer where its handles are rather than assuming a shape, so a
 * plugin kind decides its own grab targets.
 */
export interface ResizableRenderer {
  /** The handle under a world point, or null when the point is not on one. */
  handleAt(worldX: number, worldY: number): ResizeHandle | null;
  /**
   * The handle under the pointer, and whether the pointer is over the object at
   * all. Called while merely hovering: the bars are drawn only for an object the
   * pointer is actually on, so a board with several things selected is not a
   * board covered in grips.
   */
  hoverHandle(handle: ResizeHandle | null, overObject?: boolean): void;
  beginResize(): void;
  applyResize(handle: ResizeHandle, deltaX: number, deltaY: number, preserveAspect: boolean): void;
  /** Commits the dragged size to the board. */
  endResize(): void;
}

export function isResizable(
  renderer: CanvasObjectRenderer | undefined,
): renderer is CanvasObjectRenderer & ResizableRenderer {
  return typeof (renderer as Partial<ResizableRenderer> | undefined)?.handleAt === "function";
}

/**
 * Corners only, and inside the object rather than straddling its edge. Handles
 * hung outside collide with whatever the object sits next to, and the mid-edge
 * ones collide with the connector ports.
 */
export function cornerHandlePoints(
  width: number,
  height: number,
  zoom: number,
): { handle: ResizeHandle; x: number; y: number }[] {
  const inset = Math.min(INSET / Math.max(0.2, zoom), width / 4, height / 4);
  return [
    { handle: "nw", x: inset, y: inset },
    { handle: "ne", x: width - inset, y: inset },
    { handle: "se", x: width - inset, y: height - inset },
    { handle: "sw", x: inset, y: height - inset },
  ];
}

export interface ResizeAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rect a resize drag lands on. `from` is the object as the gesture started
 * and the deltas are measured from that same instant, so the far corner stays
 * put: reading the object's live position instead would fold each frame's own
 * output back into the next one and walk it across the board.
 */
export function resizedRect(
  from: ResizeAnchor,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  freeAspect: boolean,
  minimum: number,
): ResizeAnchor {
  const growX = handle.includes("e") ? deltaX : handle.includes("w") ? -deltaX : 0;
  const growY = handle.startsWith("s") ? deltaY : handle.startsWith("n") ? -deltaY : 0;
  const width = Math.round(Math.max(minimum, from.width + growX));
  const height = Math.round(
    freeAspect
      ? Math.max(minimum, from.height + growY)
      : Math.max(minimum, width * (from.height / from.width)),
  );

  return {
    x: Math.round(handle.includes("w") ? from.x + (from.width - width) : from.x),
    y: Math.round(handle.startsWith("n") ? from.y + (from.height - height) : from.y),
    width,
    height,
  };
}

/**
 * The four edge midpoints, which is where a card on this board is resized from.
 * Spatial puts thin bars there and nothing on the corners — it only grew corner
 * handles in v1.0.22 — and the bars never collide with a neighbouring card the
 * way a handle hung off a corner does.
 */
export function edgeHandlePoints(
  width: number,
  height: number,
  inset = 0,
): { handle: ResizeHandle; x: number; y: number }[] {
  // Never past the middle: on a card dragged down to the minimum the four bars
  // would otherwise cross over and swap sides.
  const gap = Math.min(inset, width / 3, height / 3);
  return [
    { handle: "n", x: width / 2, y: gap },
    { handle: "e", x: width - gap, y: height / 2 },
    { handle: "s", x: width / 2, y: height - gap },
    { handle: "w", x: gap, y: height / 2 },
  ];
}

/**
 * The edge handle under a world-local point. The grab box is the bar itself
 * grown by `reach`, so a thin bar is still easy to hit, and it is measured per
 * axis rather than as a radius: a 22px bar wants a long thin target, not a
 * circle that also covers the corner next to it.
 */
export function edgeHandleAt(
  localX: number,
  localY: number,
  width: number,
  height: number,
  zoom: number,
  paint: Pick<EdgeHandlePaint, "length" | "thickness" | "inset">,
  reach: number,
): ResizeHandle | null {
  const metrics = edgeHandleMetrics(width, height, zoom, paint);
  const half = metrics.length / 2;
  // The grab box never outgrows the bar's own half-length, or the four targets
  // meet in the middle of a small card and the nearest one always wins.
  const grab = Math.min(reach / Math.max(0.2, zoom), half);

  for (const point of edgeHandlePoints(width, height, metrics.inset)) {
    const horizontal = point.handle === "n" || point.handle === "s";
    const withinBar = horizontal
      ? Math.abs(localX - point.x) <= half
      : Math.abs(localY - point.y) <= half;
    const withinEdge = horizontal
      ? Math.abs(localY - point.y) <= grab
      : Math.abs(localX - point.x) <= grab;
    if (withinBar && withinEdge) return point.handle;
  }
  return null;
}

export interface EdgeHandlePaint {
  color: number;
  length: number;
  thickness: number;
  /**
   * Screen pixels the bar sits in from the edge. A bar centred on the edge hangs
   * half of itself over the outside of the card, which reads as chrome bolted on
   * rather than as a grip on the thing itself.
   */
  inset?: number;
}

export interface EdgeHandleMetrics {
  length: number;
  thickness: number;
  inset: number;
}

/**
 * The bars in world units. Sizes are screen pixels divided by the zoom so a
 * handle is the same thing to aim at however far out the board is — but only up
 * to a point: zoomed out far enough, a 22px bar is worth more world units than
 * the card is wide, and the chrome swallows the thing it belongs to. Past that
 * the bars shrink with the card instead.
 *
 * Drawing and hit testing both come through here, so what is painted and what
 * can be grabbed cannot drift apart.
 */
export function edgeHandleMetrics(
  width: number,
  height: number,
  zoom: number,
  paint: Pick<EdgeHandlePaint, "length" | "thickness" | "inset">,
): EdgeHandleMetrics {
  const scale = Math.max(0.2, zoom);
  const shortest = Math.max(1, Math.min(width, height));
  const length = Math.min(paint.length / scale, shortest * 0.35);
  return {
    length,
    thickness: Math.min(paint.thickness / scale, length / 3),
    inset: Math.min((paint.inset ?? 0) / scale, shortest * 0.12),
  };
}

/**
 * The bars themselves. Sizes are screen pixels divided by the zoom, so a handle
 * is the same thing to aim at however far out the board is, and `hot` is the one
 * under the pointer.
 */
export function drawEdgeHandles(
  graphics: Graphics,
  width: number,
  height: number,
  zoom: number,
  visible: boolean,
  hotHandle: ResizeHandle | null,
  paint: EdgeHandlePaint,
): void {
  graphics.clear();
  if (!visible) return;

  const { length, thickness, inset } = edgeHandleMetrics(width, height, zoom, paint);

  for (const point of edgeHandlePoints(width, height, inset)) {
    const horizontal = point.handle === "n" || point.handle === "s";
    const barWidth = horizontal ? length : thickness;
    const barHeight = horizontal ? thickness : length;
    graphics.roundRect(
      point.x - barWidth / 2,
      point.y - barHeight / 2,
      barWidth,
      barHeight,
      thickness / 2,
    );
    // Faint until aimed at. A grip is an affordance, not a thing to look at.
    graphics.fill({ color: paint.color, alpha: point.handle === hotHandle ? 0.9 : 0.4 });
  }
}

/** Grab radius in world units, so a handle stays the same size to aim at. */
export function handleReach(zoom: number): number {
  return REACH / Math.max(0.2, zoom);
}

export function resizeHandleAt(
  localX: number,
  localY: number,
  width: number,
  height: number,
  zoom: number,
): ResizeHandle | null {
  const reach = handleReach(zoom);
  for (const point of cornerHandlePoints(width, height, zoom)) {
    if (Math.hypot(localX - point.x, localY - point.y) <= reach) return point.handle;
  }
  return null;
}

/**
 * Opacity a handle is drawn at, given how far the pointer is from it. Fully lit
 * inside the grab radius, gone past the fade distance — handles that are always
 * on turn a busy board into a field of dots.
 */
export function handleOpacity(distance: number, zoom: number): number {
  const reach = handleReach(zoom);
  const fade = FADE / Math.max(0.2, zoom);
  if (distance <= reach) return 1;
  return Math.max(0, 1 - (distance - reach) / (fade - reach));
}

export interface HandlePaint {
  fill: number;
  ring: number;
  hot: number;
}

/** `pointer` is in object-local coordinates; null draws nothing. */
export function drawCornerHandles(
  graphics: Graphics,
  width: number,
  height: number,
  zoom: number,
  pointer: Point | null,
  hotHandle: ResizeHandle | null,
  paint: HandlePaint,
): void {
  graphics.clear();
  if (!pointer) return;

  const scale = Math.max(0.2, zoom);
  const radius = RADIUS / scale;

  for (const point of cornerHandlePoints(width, height, zoom)) {
    const opacity = handleOpacity(Math.hypot(pointer.x - point.x, pointer.y - point.y), zoom);
    if (opacity <= 0.02) continue;

    const hot = point.handle === hotHandle;
    const size = hot ? radius * 1.3 : radius;
    graphics.circle(point.x, point.y, size);
    graphics.fill({ color: hot ? paint.hot : paint.fill, alpha: opacity });
    graphics.circle(point.x, point.y, size);
    graphics.stroke({ width: 1.5 / scale, color: paint.ring, alpha: opacity * 0.9 });
  }
}

/**
 * A card drawn in Pixi has no child buttons, so the chrome inside it — file
 * chips, Allow and Deny — answers to a press the renderer resolves itself.
 */
export interface PressableRenderer {
  /** True when the press hit a row: the tool leaves the card alone. */
  pressAt(worldX: number, worldY: number): boolean;
}

export function isPressable(
  renderer: CanvasObjectRenderer | undefined,
): renderer is CanvasObjectRenderer & PressableRenderer {
  return typeof (renderer as Partial<PressableRenderer> | undefined)?.pressAt === "function";
}

/**
 * Chrome inside a card that lights up under the pointer — the folder's arrow.
 * The point is object-local business and null says the pointer has left the card
 * altogether; the answer is whether it is on something pressable, which is what
 * turns the cursor into a hand.
 */
export interface HoverableRenderer {
  hoverAt(point: Point | null): boolean;
}

export function isHoverable(
  renderer: CanvasObjectRenderer | undefined,
): renderer is CanvasObjectRenderer & HoverableRenderer {
  return typeof (renderer as Partial<HoverableRenderer> | undefined)?.hoverAt === "function";
}
