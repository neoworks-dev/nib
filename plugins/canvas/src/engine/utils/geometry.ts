import type { Point, Rect } from "@nib-ui/ui-contracts";

export function pointInRect(x: number, y: number, rect: Rect, padding = 0): boolean {
  return (
    x >= rect.x - padding &&
    x <= rect.x + rect.width + padding &&
    y >= rect.y - padding &&
    y <= rect.y + rect.height + padding
  );
}

/**
 * Overlap by area, so touching edges do not count and a rubber band that has not
 * been dragged anywhere selects nothing — not even the card it started on.
 */
export function rectsIntersect(left: Rect, right: Rect): boolean {
  if (left.width <= 0 || left.height <= 0 || right.width <= 0 || right.height <= 0) return false;
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

/** The rectangle two dragged corners describe, whichever way the drag went. */
export function rectFromCorners(anchor: Point, corner: Point): Rect {
  return {
    x: Math.min(anchor.x, corner.x),
    y: Math.min(anchor.y, corner.y),
    width: Math.abs(corner.x - anchor.x),
    height: Math.abs(corner.y - anchor.y),
  };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A cubic bezier between two objects: it leaves and enters horizontally. */
export interface Curve {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
}

/**
 * The curve two cards are joined by. It meets each of them where a straight line
 * would, and leaves horizontally, which is what reads as a connector rather than
 * as a diagonal; the bend grows with the gap, so neighbours are not over-curved.
 */
export function curveBetween(from: Rect, to: Rect): Curve {
  const start = edgePoint(from, rectCenter(to));
  const end = edgePoint(to, rectCenter(from));
  const bend = Math.max(40, Math.abs(end.x - start.x) * 0.5);
  const direction = end.x >= start.x ? 1 : -1;

  return {
    start,
    control1: { x: start.x + bend * direction, y: start.y },
    control2: { x: end.x - bend * direction, y: end.y },
    end,
  };
}

export function pointOnCurve(curve: Curve, t: number): Point {
  const inverse = 1 - t;
  const start = inverse * inverse * inverse;
  const control1 = 3 * inverse * inverse * t;
  const control2 = 3 * inverse * t * t;
  const end = t * t * t;
  return {
    x:
      start * curve.start.x +
      control1 * curve.control1.x +
      control2 * curve.control2.x +
      end * curve.end.x,
    y:
      start * curve.start.y +
      control1 * curve.control1.y +
      control2 * curve.control2.y +
      end * curve.end.y,
  };
}

/** Distance from a point to the curve, sampled: exact enough to press a line with. */
export function distanceToCurve(curve: Curve, x: number, y: number, samples = 24): number {
  let nearest = Infinity;
  for (let step = 0; step <= samples; step += 1) {
    const point = pointOnCurve(curve, step / samples);
    nearest = Math.min(nearest, Math.hypot(point.x - x, point.y - y));
  }
  return nearest;
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Point on the bounding-box edge of `rect` in the direction of `toward`. */
export function edgePoint(rect: Rect, toward: Point): Point {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const deltaX = toward.x - centerX;
  const deltaY = toward.y - centerY;
  if (Math.abs(deltaX) < 0.001 && Math.abs(deltaY) < 0.001) return { x: centerX, y: centerY };

  const scaleX = deltaX !== 0 ? rect.width / 2 / Math.abs(deltaX) : Infinity;
  const scaleY = deltaY !== 0 ? rect.height / 2 / Math.abs(deltaY) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: centerX + scale * deltaX, y: centerY + scale * deltaY };
}

export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
