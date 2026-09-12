import { describe, expect, test } from "bun:test";
import {
  cornerHandlePoints,
  handleOpacity,
  handleReach,
  resizedRect,
  resizeHandleAt,
} from "../src/engine/resize";

const WIDTH = 288;
const HEIGHT = 160;

describe("cornerHandlePoints", () => {
  test("four corners, all inside the object", () => {
    const points = cornerHandlePoints(WIDTH, HEIGHT, 1);

    expect(points.map((point) => point.handle)).toEqual(["nw", "ne", "se", "sw"]);
    for (const point of points) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.y).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(WIDTH);
      expect(point.y).toBeLessThan(HEIGHT);
    }
  });

  test("the inset shrinks with the zoom so the handles stay a constant size on screen", () => {
    const near = cornerHandlePoints(WIDTH, HEIGHT, 2)[0]!;
    const far = cornerHandlePoints(WIDTH, HEIGHT, 0.5)[0]!;

    expect(near.x).toBeLessThan(far.x);
  });

  test("a tiny object never pushes its handles past the middle", () => {
    const points = cornerHandlePoints(20, 20, 0.2);

    expect(points[0]!.x).toBeLessThanOrEqual(5);
    expect(points[0]!.y).toBeLessThanOrEqual(5);
  });
});

describe("resizeHandleAt", () => {
  test("finds the corner under the pointer", () => {
    const corner = cornerHandlePoints(WIDTH, HEIGHT, 1)[2]!;

    expect(resizeHandleAt(corner.x, corner.y, WIDTH, HEIGHT, 1)).toBe("se");
  });

  test("the middle of the object is not a handle", () => {
    expect(resizeHandleAt(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 1)).toBeNull();
  });

  test("mid-edge points are not corner handles", () => {
    expect(resizeHandleAt(WIDTH, HEIGHT / 2, WIDTH, HEIGHT, 1)).toBeNull();
    expect(resizeHandleAt(WIDTH / 2, HEIGHT, WIDTH, HEIGHT, 1)).toBeNull();
  });

  test("the grab radius grows in world units as the board zooms out", () => {
    expect(handleReach(0.5)).toBeGreaterThan(handleReach(2));
  });
});

describe("handleOpacity", () => {
  test("a pointer on the handle draws it solid", () => {
    expect(handleOpacity(0, 1)).toBe(1);
    expect(handleOpacity(handleReach(1), 1)).toBe(1);
  });

  test("fades out with distance and reaches nothing", () => {
    const near = handleOpacity(handleReach(1) + 10, 1);
    const far = handleOpacity(handleReach(1) + 40, 1);

    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(handleOpacity(1000, 1)).toBe(0);
  });
});

describe("resizedRect", () => {
  const from = { x: 100, y: 50, width: 320, height: 240 };

  test("a south-east drag grows the rect and leaves its origin alone", () => {
    expect(resizedRect(from, "se", 40, 40, true, 48)).toEqual({
      x: 100,
      y: 50,
      width: 360,
      height: 280,
    });
  });

  test("a north-west drag pins the opposite corner instead of moving the rect", () => {
    const next = resizedRect(from, "nw", -40, -40, true, 48);

    expect(next).toEqual({ x: 60, y: 10, width: 360, height: 280 });
    expect(next.x + next.width).toBe(from.x + from.width);
    expect(next.y + next.height).toBe(from.y + from.height);
  });

  /**
   * The tool reports the whole gesture on every frame, so applying frame two to
   * frame one's output is what used to walk the object across the board.
   */
  test("a longer drag lands where the pointer is, not twice as far", () => {
    const half = resizedRect(from, "nw", -20, -20, true, 48);
    const whole = resizedRect(from, "nw", -40, -40, true, 48);

    expect(half).toEqual({ x: 80, y: 30, width: 340, height: 260 });
    expect(whole.x).toBe(60);
    expect(resizedRect(half, "nw", -40, -40, true, 48).x).not.toBe(whole.x);
  });

  test("kept aspect ignores the vertical delta; a free one follows it", () => {
    expect(resizedRect(from, "se", 320, 0, false, 48).height).toBe(480);
    expect(resizedRect(from, "se", 320, 0, true, 48).height).toBe(240);
  });

  test("the minimum stops the rect shrinking and holds the anchored edge", () => {
    const next = resizedRect(from, "nw", 10_000, 10_000, true, 48);

    expect(next.width).toBe(48);
    expect(next.x + next.width).toBe(from.x + from.width);
  });
});
