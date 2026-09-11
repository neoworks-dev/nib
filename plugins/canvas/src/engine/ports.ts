import type { CanvasObjectRenderer, Point } from "@nib-ui/ui-contracts";
import type { Graphics } from "pixi.js";

/** Where a connector can be dragged out of: one button centred outside each edge. */
export type ConnectPort = "top" | "right" | "bottom" | "left";

const PORTS: ConnectPort[] = ["top", "right", "bottom", "left"];

/** Screen pixels, converted to world units against the camera at draw time. */
const SIZE = 18;
const CORNER = 5;
/** Distance from the object's edge to the near side of the button. */
const GAP = 5;
const REACH = 12;
const FADE = 110;

/**
 * Opted into by a renderer that can be the source of a new link. The select tool
 * drives the gesture and hands the result back through `CanvasEngineApi.connect`,
 * so it never learns what the objects on either end are.
 */
export interface ConnectableRenderer {
  /** The port under a world point, or null when the point is not on one. */
  portAt(worldX: number, worldY: number): ConnectPort | null;
  /** Draws the port under the pointer as hot; called while merely hovering. */
  hoverPort(port: ConnectPort | null): void;
  /** World point a dragged connector starts from. */
  portAnchor(port: ConnectPort): Point;
}

export function isConnectable(
  renderer: CanvasObjectRenderer | undefined,
): renderer is CanvasObjectRenderer & ConnectableRenderer {
  return typeof (renderer as Partial<ConnectableRenderer> | undefined)?.portAt === "function";
}

/**
 * Where a connector leaves the object: centred on the edge, in object-local
 * coordinates. The button that starts the drag sits further out — see
 * `portCenter` — but a link drawn from there would float off its own card.
 */
export function portAnchor(port: ConnectPort, width: number, height: number): Point {
  switch (port) {
    case "top":
      return { x: width / 2, y: 0 };
    case "right":
      return { x: width, y: height / 2 };
    case "bottom":
      return { x: width / 2, y: height };
    case "left":
      return { x: 0, y: height / 2 };
  }
}

/** The button's centre: clear of the card, so it never sits on top of its content. */
export function portCenter(port: ConnectPort, width: number, height: number, zoom: number): Point {
  const offset = (GAP + SIZE / 2) / Math.max(0.2, zoom);
  const anchor = portAnchor(port, width, height);
  switch (port) {
    case "top":
      return { x: anchor.x, y: anchor.y - offset };
    case "right":
      return { x: anchor.x + offset, y: anchor.y };
    case "bottom":
      return { x: anchor.x, y: anchor.y + offset };
    case "left":
      return { x: anchor.x - offset, y: anchor.y };
  }
}

/** Grab half-extent in world units, so a button stays the same size to aim at. */
export function portReach(zoom: number): number {
  return REACH / Math.max(0.2, zoom);
}

export function portAtPoint(
  localX: number,
  localY: number,
  width: number,
  height: number,
  zoom: number,
): ConnectPort | null {
  const reach = portReach(zoom);
  for (const port of PORTS) {
    const center = portCenter(port, width, height, zoom);
    if (Math.abs(localX - center.x) <= reach && Math.abs(localY - center.y) <= reach) return port;
  }
  return null;
}

/**
 * Opacity a port is drawn at, given how far the pointer is from it. The same
 * approach fade the resize handles use: four always-on buttons per card turn a
 * board into a field of plus signs.
 */
export function portOpacity(distance: number, zoom: number): number {
  const reach = portReach(zoom);
  const fade = FADE / Math.max(0.2, zoom);
  if (distance <= reach) return 1;
  return Math.max(0, 1 - (distance - reach) / (fade - reach));
}

export interface PortPaint {
  fill: number;
  ring: number;
  glyph: number;
  hot: number;
}

/**
 * A plus outside each edge, faded by how close the pointer is. `pointer` is in
 * object-local coordinates; null draws nothing, which is the resting state of an
 * untouched board.
 */
export function drawPorts(
  graphics: Graphics,
  width: number,
  height: number,
  zoom: number,
  pointer: Point | null,
  hotPort: ConnectPort | null,
  paint: PortPaint,
): void {
  graphics.clear();
  if (!pointer) return;

  const scale = Math.max(0.2, zoom);
  const size = SIZE / scale;
  const radius = CORNER / scale;
  const arm = size * 0.26;

  for (const port of PORTS) {
    const center = portCenter(port, width, height, zoom);
    const opacity = portOpacity(Math.hypot(pointer.x - center.x, pointer.y - center.y), zoom);
    if (opacity <= 0.02) continue;

    const hot = port === hotPort;
    const half = (hot ? size * 1.12 : size) / 2;

    graphics.roundRect(center.x - half, center.y - half, half * 2, half * 2, radius);
    graphics.fill({ color: paint.fill, alpha: opacity });
    graphics.roundRect(center.x - half, center.y - half, half * 2, half * 2, radius);
    graphics.stroke({
      width: 1 / scale,
      color: hot ? paint.hot : paint.ring,
      alpha: opacity * 0.9,
    });

    graphics.moveTo(center.x - arm, center.y);
    graphics.lineTo(center.x + arm, center.y);
    graphics.moveTo(center.x, center.y - arm);
    graphics.lineTo(center.x, center.y + arm);
    graphics.stroke({ width: 1.8 / scale, color: paint.glyph, alpha: opacity, cap: "round" });
  }
}
