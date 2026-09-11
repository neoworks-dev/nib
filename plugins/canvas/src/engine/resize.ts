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
  /** Draws the handle under the pointer as hot; called while merely hovering. */
  hoverHandle(handle: ResizeHandle | null): void;
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
