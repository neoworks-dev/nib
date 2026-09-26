import type { PaneEdge } from "@nib-ui/ui-contracts";

/** The area docks are measured against — the main region, not the viewport. */
export interface Bounds {
  width: number;
  height: number;
}

export const MIN_DOCK_WIDTH = 280;
export const MIN_DOCK_HEIGHT = 200;
/** What the board keeps whatever the docks ask for: it is never covered over. */
export const MIN_BOARD_WIDTH = 360;
export const MIN_BOARD_HEIGHT = 260;

/**
 * The gap the drawer keeps from the edges of the board it lies on: held off the
 * edge, it reads as a layer over the board rather than as a dock beside it.
 */
export const DRAWER_MARGIN = 8;

/** A dock opens taking about a third of the area, and is dragged from there. */
export const DEFAULT_DOCK_SIZE = 0.32;

/** The order a pane looks for an edge of its own in, once it asks to be detached. */
export const EDGE_ORDER: PaneEdge[] = ["right", "bottom", "left", "top"];

export function dockAxis(edge: PaneEdge): "row" | "column" {
  return edge === "left" || edge === "right" ? "row" : "column";
}

/** The bound's extent along the dock's own axis: what its fraction is taken of. */
export function dockExtent(edge: PaneEdge, bounds: Bounds): number {
  return dockAxis(edge) === "row" ? bounds.width : bounds.height;
}

function minimumPixels(edge: PaneEdge): number {
  return dockAxis(edge) === "row" ? MIN_DOCK_WIDTH : MIN_DOCK_HEIGHT;
}

function boardPixels(edge: PaneEdge): number {
  return dockAxis(edge) === "row" ? MIN_BOARD_WIDTH : MIN_BOARD_HEIGHT;
}

/**
 * A dock is at least wide enough to hold a pane and never wide enough to leave
 * the board with nothing. An area too small to grant both gives each half of what
 * there is, so a narrow window shows a squeezed board rather than no board.
 */
export function clampDockSize(edge: PaneEdge, size: number, bounds: Bounds): number {
  const extent = dockExtent(edge, bounds);
  if (extent <= 0) return 0;

  const smallest = Math.min(minimumPixels(edge), extent / 2);
  const largest = Math.max(extent - boardPixels(edge), smallest);
  const pixels = Math.min(Math.max(size * extent, smallest), Math.min(largest, extent));
  return pixels / extent;
}

export function dockPixels(edge: PaneEdge, size: number, bounds: Bounds): number {
  return Math.round(clampDockSize(edge, size, bounds) * dockExtent(edge, bounds));
}

/**
 * Which edge a point in the area belongs to. Every point has one: a pane let go
 * over the middle of the board docks against whichever edge it was nearest,
 * rather than floating where it was dropped.
 */
export function nearestEdge(x: number, y: number, bounds: Bounds): PaneEdge {
  const distances: Record<PaneEdge, number> = {
    left: x,
    right: bounds.width - x,
    top: y,
    bottom: bounds.height - y,
  };
  let nearest: PaneEdge = "right";
  for (const edge of EDGE_ORDER) if (distances[edge] < distances[nearest]) nearest = edge;
  return nearest;
}
