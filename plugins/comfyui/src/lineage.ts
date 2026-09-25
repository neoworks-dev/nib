/**
 * The line between a picture a ComfyUI run was given and one it made from it:
 * a curve leaving the side of the source that faces the result, and arriving on
 * the side of the result that faces the source.
 */

import {
  COMFY_LINEAGE_KIND,
  type CanvasEngineApi,
  type CanvasObjectKind,
  type CanvasObjectRenderer,
  type ComfyLineageObject,
  type Point,
  type Rect,
} from "@nib-ui/ui-contracts";
import { Container, Graphics } from "pixi.js";

const LINE_COLOR = 0x9aa0a9;
const LINE_WIDTH = 2;
const END_RADIUS = 4;
/** How far the curve's handles reach at the least, so two close cards still get a bend. */
const MIN_HANDLE = 40;

/** A cubic Bézier curve. */
export interface Curve {
  start: Point;
  startHandle: Point;
  endHandle: Point;
  end: Point;
}

/**
 * The curve from one card to another. Side by side it runs from edge to facing
 * edge with horizontal handles; stacked, from bottom to top with vertical ones —
 * whichever gap between the cards is wider decides.
 */
export function lineageCurve(from: Rect, to: Rect): Curve {
  const gapX = horizontalGap(from, to);
  const gapY = verticalGap(from, to);
  if (gapX >= gapY) return sideways(from, to);
  return upright(from, to);
}

/** The kind the board draws lineage objects with. */
export function lineageKind(): CanvasObjectKind<ComfyLineageObject> {
  return {
    kind: COMFY_LINEAGE_KIND,
    parse: parseLineage,
    createRenderer: (engine) => new LineageRenderer(engine),
  };
}

/** A lineage object from the board document, or null for anything malformed. */
export function parseLineage(raw: unknown): ComfyLineageObject | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.kind !== COMFY_LINEAGE_KIND || typeof candidate.id !== "string") return null;
  if (typeof candidate.from !== "string" || typeof candidate.to !== "string") return null;
  return { kind: COMFY_LINEAGE_KIND, id: candidate.id, from: candidate.from, to: candidate.to };
}

/**
 * Draws the curve between the two cards wherever they are. It has no rectangle
 * of its own: it cannot be selected or hit, and it vanishes while either card is
 * not on this board.
 */
class LineageRenderer implements CanvasObjectRenderer<ComfyLineageObject> {
  readonly container = new Container();
  private readonly line = new Graphics();
  private signature = "";

  constructor(private readonly engine: CanvasEngineApi) {
    this.container.eventMode = "none";
    this.container.addChild(this.line);
  }

  /** Redraws when either card has moved or changed size. */
  sync(data: ComfyLineageObject): void {
    const from = this.engine.objectBounds(data.from);
    const to = this.engine.objectBounds(data.to);
    if (!from || !to) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    const signature = JSON.stringify([from, to]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.draw(lineageCurve(from, to));
  }

  bounds(): Rect | null {
    return null;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  /** The curve, with a dot where it leaves the source and where it meets the result. */
  private draw(curve: Curve): void {
    const { start, startHandle, endHandle, end } = curve;
    this.line
      .clear()
      .moveTo(start.x, start.y)
      .bezierCurveTo(startHandle.x, startHandle.y, endHandle.x, endHandle.y, end.x, end.y)
      .stroke({ width: LINE_WIDTH, color: LINE_COLOR })
      .circle(start.x, start.y, END_RADIUS)
      .circle(end.x, end.y, END_RADIUS)
      .fill({ color: LINE_COLOR });
  }
}

/** Space between the cards across, negative when they overlap across. */
function horizontalGap(from: Rect, to: Rect): number {
  return Math.max(to.x - (from.x + from.width), from.x - (to.x + to.width));
}

/** Space between the cards down, negative when they overlap down. */
function verticalGap(from: Rect, to: Rect): number {
  return Math.max(to.y - (from.y + from.height), from.y - (to.y + to.height));
}

/** From the source's facing side edge to the result's, handles pointing across. */
function sideways(from: Rect, to: Rect): Curve {
  const rightward = to.x >= from.x;
  const start = { x: rightward ? from.x + from.width : from.x, y: from.y + from.height / 2 };
  const end = { x: rightward ? to.x : to.x + to.width, y: to.y + to.height / 2 };
  const handle = Math.max(MIN_HANDLE, Math.abs(end.x - start.x) / 2);
  const direction = rightward ? 1 : -1;
  return {
    start,
    startHandle: { x: start.x + handle * direction, y: start.y },
    endHandle: { x: end.x - handle * direction, y: end.y },
    end,
  };
}

/** From the source's facing top or bottom edge to the result's, handles pointing down or up. */
function upright(from: Rect, to: Rect): Curve {
  const downward = to.y >= from.y;
  const start = { x: from.x + from.width / 2, y: downward ? from.y + from.height : from.y };
  const end = { x: to.x + to.width / 2, y: downward ? to.y : to.y + to.height };
  const handle = Math.max(MIN_HANDLE, Math.abs(end.y - start.y) / 2);
  const direction = downward ? 1 : -1;
  return {
    start,
    startHandle: { x: start.x, y: start.y + handle * direction },
    endHandle: { x: end.x, y: end.y - handle * direction },
    end,
  };
}
