import { describe, expect, test } from "bun:test";
import {
  type Bounds,
  clampDockSize,
  dockAxis,
  dockExtent,
  dockPixels,
  MIN_BOARD_HEIGHT,
  MIN_BOARD_WIDTH,
  MIN_DOCK_HEIGHT,
  MIN_DOCK_WIDTH,
  nearestEdge,
} from "../src/lib/client/layout/docks";

const bounds: Bounds = { width: 1000, height: 800 };

describe("dockAxis", () => {
  test("a side dock is measured across and a top or bottom one down", () => {
    expect(dockAxis("left")).toBe("row");
    expect(dockAxis("right")).toBe("row");
    expect(dockAxis("top")).toBe("column");
    expect(dockExtent("right", bounds)).toBe(1000);
    expect(dockExtent("bottom", bounds)).toBe(800);
  });
});

describe("clampDockSize", () => {
  test("a dock is never narrower than a pane needs", () => {
    expect(dockPixels("right", 0.01, bounds)).toBe(MIN_DOCK_WIDTH);
    expect(dockPixels("bottom", 0.01, bounds)).toBe(MIN_DOCK_HEIGHT);
  });

  test("a dock never takes the board's own minimum, so the board is always on screen", () => {
    expect(dockPixels("right", 1, bounds)).toBe(bounds.width - MIN_BOARD_WIDTH);
    expect(dockPixels("top", 1, bounds)).toBe(bounds.height - MIN_BOARD_HEIGHT);
  });

  test("an area too small for both gives each half of what there is", () => {
    const cramped: Bounds = { width: 300, height: 240 };

    expect(dockPixels("left", 1, cramped)).toBe(150);
    expect(dockPixels("bottom", 0.01, cramped)).toBe(120);
  });

  test("an unmeasured area has no dock in it at all", () => {
    expect(clampDockSize("right", 0.5, { width: 0, height: 0 })).toBe(0);
  });
});

describe("nearestEdge", () => {
  test("a point takes the edge it is closest to", () => {
    expect(nearestEdge(20, 400, bounds)).toBe("left");
    expect(nearestEdge(980, 400, bounds)).toBe("right");
    expect(nearestEdge(500, 10, bounds)).toBe("top");
    expect(nearestEdge(500, 790, bounds)).toBe("bottom");
  });

  test("the middle of the board still names an edge: nothing floats", () => {
    expect(nearestEdge(500, 400, bounds)).toBe("bottom");
  });
});
