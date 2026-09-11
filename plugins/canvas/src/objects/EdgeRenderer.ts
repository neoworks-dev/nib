import type { CanvasEngineApi, CanvasObjectKind, Point, Rect } from "@nib-ui/ui-contracts";
import { Container, Graphics } from "pixi.js";
import { ObjectRenderer } from "../engine/ObjectRenderer";
import { type Curve, curveBetween, distanceToCurve, pointOnCurve } from "../engine/utils/geometry";
import type { BoardTheme } from "../theme";
import { type EdgeObject, parseEdge } from "../workstream";

const ARROW = 10;
/** Half the side of the box the edge offers to a rubber band, around its middle. */
const GRAB = 12;
/** Screen pixels around the curve that still count as a press on it. */
const HIT_TOLERANCE = 6;

export interface EdgeDeps {
  theme(): BoardTheme;
}

/**
 * A branch or a join between two workstreams. Endpoints are read from the live
 * renderers every frame rather than stored, so the line follows a card while it
 * is being dragged.
 */
export class EdgeRenderer extends ObjectRenderer<EdgeObject> {
  readonly container = new Container();

  private readonly line = new Graphics();
  private curve: Curve | null = null;

  constructor(
    private readonly engine: CanvasEngineApi,
    private readonly deps: EdgeDeps,
  ) {
    super();
    // Edges sit behind every card so a line never covers text.
    this.container.zIndex = -100;
    this.container.eventMode = "none";
    this.container.addChild(this.line);
  }

  /** An edge has no spawn animation: it would pop away from its endpoints. */
  override spawn(): void {
    this.container.alpha = 1;
  }

  sync(data: EdgeObject, selection: string[]): void {
    const from = this.engine.objectBounds(data.fromId);
    const to = this.engine.objectBounds(data.toId);
    this.container.visible = Boolean(from && to);
    if (!from || !to) return;

    const theme = this.deps.theme();
    const selected = selection.includes(data.id);
    const curve = curveBetween(from, to);
    this.curve = curve;

    const color = selected ? theme.action : theme.borderStrong;
    const alpha = selected ? 0.95 : 0.6;
    const line = this.line;
    line.clear();
    line.moveTo(curve.start.x, curve.start.y);
    line.bezierCurveTo(
      curve.control1.x,
      curve.control1.y,
      curve.control2.x,
      curve.control2.y,
      curve.end.x,
      curve.end.y,
    );
    line.stroke({ width: selected ? 2 : 1.5, color, alpha, cap: "round" });

    // The head sits along the curve's own tangent, not the line between the cards.
    if (data.direction === "forward" || data.direction === "both") {
      this.arrowHead(curve.control2, curve.end, color, alpha);
    }
    if (data.direction === "backward" || data.direction === "both") {
      this.arrowHead(curve.control1, curve.start, color, alpha);
    }
  }

  /**
   * A box around the middle of the curve. The whole curve's extent would mean a
   * rubber band over two cards swept up the edge between them as well.
   */
  override bounds(): Rect | null {
    if (!this.curve) return null;
    const middle = pointOnCurve(this.curve, 0.5);
    return { x: middle.x - GRAB, y: middle.y - GRAB, width: GRAB * 2, height: GRAB * 2 };
  }

  /** The line itself is the target: anywhere along the curve, within a few pixels. */
  override hitTest(worldX: number, worldY: number): boolean {
    if (!this.curve) return false;
    return distanceToCurve(this.curve, worldX, worldY) <= HIT_TOLERANCE / this.engine.camera.zoom;
  }

  private arrowHead(from: Point, to: Point, color: number, alpha: number): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    this.line.moveTo(to.x, to.y);
    this.line.lineTo(
      to.x - ARROW * Math.cos(angle - Math.PI / 6),
      to.y - ARROW * Math.sin(angle - Math.PI / 6),
    );
    this.line.lineTo(
      to.x - ARROW * Math.cos(angle + Math.PI / 6),
      to.y - ARROW * Math.sin(angle + Math.PI / 6),
    );
    this.line.closePath();
    this.line.fill({ color, alpha });
  }
}

export function edgeKind(deps: EdgeDeps): CanvasObjectKind<EdgeObject> {
  return {
    kind: "edge",
    parse: parseEdge,
    createRenderer: (engine) => new EdgeRenderer(engine, deps),
    hitPadding: 4,
  };
}
