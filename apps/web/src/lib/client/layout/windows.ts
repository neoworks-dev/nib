export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The area windows float in — the main region, not the viewport. */
export interface Bounds {
  width: number;
  height: number;
}

export type ResizeHandle = "right" | "bottom" | "corner";

export const MIN_WINDOW_WIDTH = 280;
export const MIN_WINDOW_HEIGHT = 200;

const CASCADE_STEP = 28;
const CASCADE_WRAP = 5;

/** Keeps a window whole and inside the area; a bound smaller than the minimum wins over it. */
export function clampRect(rect: WindowRect, bounds: Bounds): WindowRect {
  const width = clamp(rect.width, MIN_WINDOW_WIDTH, Math.max(bounds.width, MIN_WINDOW_WIDTH));
  const height = clamp(rect.height, MIN_WINDOW_HEIGHT, Math.max(bounds.height, MIN_WINDOW_HEIGHT));
  return {
    width,
    height,
    x: clamp(rect.x, 0, Math.max(bounds.width - width, 0)),
    y: clamp(rect.y, 0, Math.max(bounds.height - height, 0)),
  };
}

export function defaultRect(bounds: Bounds): WindowRect {
  return clampRect(
    {
      x: 24,
      y: 24,
      width: Math.round(bounds.width * 0.42),
      height: Math.round(bounds.height * 0.6),
    },
    bounds,
  );
}

/**
 * Each window steps down and right off the one before it so a newly opened pane
 * never lands exactly on its neighbour; the offset wraps rather than marching
 * every window into the corner.
 */
export function cascadeRect(taken: WindowRect[], bounds: Bounds): WindowRect {
  const base = defaultRect(bounds);
  const offset = (taken.length % CASCADE_WRAP) * CASCADE_STEP;
  return clampRect({ ...base, x: base.x + offset, y: base.y + offset }, bounds);
}

export function moveRect(rect: WindowRect, dx: number, dy: number, bounds: Bounds): WindowRect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds);
}

/** Resizing holds the top-left corner still, so the far edge is what the bound caps. */
export function resizeRect(
  rect: WindowRect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  bounds: Bounds,
): WindowRect {
  const width = handle === "bottom" ? rect.width : rect.width + dx;
  const height = handle === "right" ? rect.height : rect.height + dy;
  return {
    ...rect,
    width: clamp(width, MIN_WINDOW_WIDTH, Math.max(bounds.width - rect.x, MIN_WINDOW_WIDTH)),
    height: clamp(height, MIN_WINDOW_HEIGHT, Math.max(bounds.height - rect.y, MIN_WINDOW_HEIGHT)),
  };
}

/**
 * Where a window dropped against an edge lands. Corners take a quarter, the
 * sides a half, and the top the whole area — the arrangement every desktop has
 * trained the gesture into.
 */
export type SnapZone =
  | "maximize"
  | "left"
  | "right"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** How close to an edge the pointer has to be, in pixels, to arm a snap. */
export const SNAP_MARGIN = 28;

/**
 * The snap the pointer is arming, or null for a drag that is nowhere near an
 * edge. Read off the pointer rather than the window: a window is wider than the
 * gesture, and its own edge is against a bound for the whole of a long drag.
 */
export function snapAt(
  x: number,
  y: number,
  bounds: Bounds,
  margin = SNAP_MARGIN,
): SnapZone | null {
  const left = x <= margin;
  const right = x >= bounds.width - margin;
  const top = y <= margin;
  const bottom = y >= bounds.height - margin;
  // Outside the area entirely — the pointer left the host — is not a snap.
  if (x < -margin || y < -margin || x > bounds.width + margin || y > bounds.height + margin)
    return null;

  if (top && left) return "top-left";
  if (top && right) return "top-right";
  if (bottom && left) return "bottom-left";
  if (bottom && right) return "bottom-right";
  if (top) return "maximize";
  if (left) return "left";
  if (right) return "right";
  if (bottom) return "bottom";
  return null;
}

export function snapRect(zone: SnapZone, bounds: Bounds): WindowRect {
  const halfWidth = Math.round(bounds.width / 2);
  const halfHeight = Math.round(bounds.height / 2);
  const rects: Record<SnapZone, WindowRect> = {
    maximize: { x: 0, y: 0, width: bounds.width, height: bounds.height },
    left: { x: 0, y: 0, width: halfWidth, height: bounds.height },
    right: { x: bounds.width - halfWidth, y: 0, width: halfWidth, height: bounds.height },
    bottom: { x: 0, y: bounds.height - halfHeight, width: bounds.width, height: halfHeight },
    "top-left": { x: 0, y: 0, width: halfWidth, height: halfHeight },
    "top-right": { x: bounds.width - halfWidth, y: 0, width: halfWidth, height: halfHeight },
    "bottom-left": { x: 0, y: bounds.height - halfHeight, width: halfWidth, height: halfHeight },
    "bottom-right": {
      x: bounds.width - halfWidth,
      y: bounds.height - halfHeight,
      width: halfWidth,
      height: halfHeight,
    },
  };
  return clampRect(rects[zone], bounds);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
