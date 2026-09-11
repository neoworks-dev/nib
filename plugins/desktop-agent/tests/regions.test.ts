import { describe, expect, test } from "bun:test";
import type { DetectedRegion } from "@nib-ui/ui-contracts";
import {
  type CapturePlacement,
  clipToImage,
  describeRegion,
  imagePointAt,
  imageToLayout,
  intersectionArea,
  layoutToImage,
  mergeRegions,
  rectArea,
  rectContains,
  regionAt,
  worldRectFor,
} from "../src/regions";

/** A 1920×1080 capture drawn at half size at the board origin. */
const placement: CapturePlacement = {
  x: 0,
  y: 0,
  width: 960,
  height: 540,
  imageWidth: 1920,
  imageHeight: 1080,
};

function region(
  id: string,
  rect: DetectedRegion["rect"],
  extra: Partial<DetectedRegion> = {},
): DetectedRegion {
  return { id, rect, source: "pixel", confidence: 1, ...extra };
}

describe("imagePointAt", () => {
  test("maps the board point into capture pixels", () => {
    expect(imagePointAt(placement, { x: 480, y: 270 })).toEqual({ x: 960, y: 540 });
  });

  test("scales the axes independently, so a squashed object still resolves", () => {
    const squashed: CapturePlacement = { ...placement, width: 960, height: 270 };
    expect(imagePointAt(squashed, { x: 480, y: 135 })).toEqual({ x: 960, y: 540 });
  });

  test("honours the object offset", () => {
    const offset: CapturePlacement = { ...placement, x: 100, y: 50 };
    expect(imagePointAt(offset, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
  });

  test.each([
    ["left of it", { x: -1, y: 10 }],
    ["above it", { x: 10, y: -1 }],
    ["right of it", { x: 961, y: 10 }],
    ["below it", { x: 10, y: 541 }],
  ])("returns null for a point %s", (_name, point) => {
    expect(imagePointAt(placement, point)).toBeNull();
  });

  test("the far edge is inside, so a click on the last pixel column still resolves", () => {
    expect(imagePointAt(placement, { x: 960, y: 540 })).toEqual({ x: 1920, y: 1080 });
  });

  test.each([
    ["zero display width", { ...placement, width: 0 }],
    ["zero display height", { ...placement, height: 0 }],
    ["zero image width", { ...placement, imageWidth: 0 }],
    ["zero image height", { ...placement, imageHeight: 0 }],
  ])("returns null for %s rather than dividing by it", (_name, broken) => {
    expect(imagePointAt(broken, { x: 1, y: 1 })).toBeNull();
  });
});

describe("worldRectFor", () => {
  test("round-trips a rect back onto the board", () => {
    const rect = worldRectFor(placement, { x: 960, y: 540, width: 200, height: 100 });
    expect(rect).toEqual({ x: 480, y: 270, width: 100, height: 50 });
  });

  test("is the inverse of imagePointAt for the top-left corner", () => {
    const offset: CapturePlacement = { ...placement, x: 40, y: 90 };
    const world = worldRectFor(offset, { x: 400, y: 200, width: 10, height: 10 })!;
    expect(imagePointAt(offset, { x: world.x, y: world.y })).toEqual({ x: 400, y: 200 });
  });

  test("returns null when the capture has no intrinsic size", () => {
    expect(
      worldRectFor({ ...placement, imageWidth: 0 }, { x: 0, y: 0, width: 1, height: 1 }),
    ).toBeNull();
  });
});

describe("rectContains", () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };

  test.each([
    ["the top-left corner", { x: 10, y: 10 }, true],
    ["inside", { x: 20, y: 20 }, true],
    ["the right edge", { x: 30, y: 20 }, false],
    ["the bottom edge", { x: 20, y: 30 }, false],
    ["just outside the left", { x: 9.9, y: 20 }, false],
  ])("%s", (_name, point, expected) => {
    expect(rectContains(rect, point)).toBe(expected);
  });

  test("a zero-area rect contains nothing, not even its own corner", () => {
    expect(rectContains({ x: 5, y: 5, width: 0, height: 10 }, { x: 5, y: 5 })).toBe(false);
  });
});

describe("regionAt", () => {
  const panel = region("panel", { x: 0, y: 0, width: 400, height: 300 });
  const button = region("button", { x: 20, y: 20, width: 80, height: 30 });
  const icon = region("icon", { x: 25, y: 25, width: 16, height: 16 });

  test("the smallest containing rect wins, so a button beats the panel holding it", () => {
    expect(regionAt([panel, button], { x: 30, y: 30 })?.id).toBe("button");
  });

  test("nesting three deep still resolves to the innermost", () => {
    expect(regionAt([panel, button, icon], { x: 30, y: 30 })?.id).toBe("icon");
  });

  test("order does not decide the winner", () => {
    expect(regionAt([icon, button, panel], { x: 30, y: 30 })?.id).toBe("icon");
  });

  test("falls back to the container outside the button", () => {
    expect(regionAt([panel, button], { x: 300, y: 200 })?.id).toBe("panel");
  });

  test("returns null outside everything, and for an empty list", () => {
    expect(regionAt([panel, button], { x: 900, y: 900 })).toBeNull();
    expect(regionAt([], { x: 0, y: 0 })).toBeNull();
  });

  test("a zero-area region is never the answer", () => {
    const degenerate = region("degenerate", { x: 20, y: 20, width: 0, height: 0 });
    expect(regionAt([button, degenerate], { x: 20, y: 20 })?.id).toBe("button");
  });
});

describe("intersectionArea", () => {
  test("overlapping rects", () => {
    expect(
      intersectionArea(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 5, width: 10, height: 10 },
      ),
    ).toBe(25);
  });

  test("rects that only touch have no area", () => {
    expect(
      intersectionArea(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 10, y: 0, width: 10, height: 10 },
      ),
    ).toBe(0);
  });

  test("disjoint rects", () => {
    expect(
      intersectionArea({ x: 0, y: 0, width: 5, height: 5 }, { x: 50, y: 50, width: 5, height: 5 }),
    ).toBe(0);
  });

  test("rectArea clamps a negative extent rather than returning a negative area", () => {
    expect(rectArea({ x: 0, y: 0, width: -10, height: 10 })).toBe(0);
  });
});

describe("mergeRegions", () => {
  const named = region(
    "save",
    { x: 0, y: 0, width: 100, height: 40 },
    { source: "atspi", label: "Save" },
  );

  test("a pixel region mostly covered by a named one is dropped", () => {
    const guessed = region("px", { x: 2, y: 2, width: 96, height: 36 });
    expect(mergeRegions([named], [guessed]).map((entry) => entry.id)).toEqual(["save"]);
  });

  test("a pixel region barely touching a named one survives", () => {
    const guessed = region("px", { x: 90, y: 0, width: 100, height: 40 });
    expect(mergeRegions([named], [guessed]).map((entry) => entry.id)).toEqual(["save", "px"]);
  });

  test("exactly half covered is kept: the rule is more than half", () => {
    const guessed = region("px", { x: 50, y: 0, width: 100, height: 40 });
    expect(mergeRegions([named], [guessed]).map((entry) => entry.id)).toEqual(["save", "px"]);
  });

  test("accessible regions never suppress each other, because a real tree nests", () => {
    const panel = region(
      "panel",
      { x: 0, y: 0, width: 400, height: 300 },
      { source: "atspi", label: "Toolbar" },
    );
    expect(mergeRegions([panel, named], []).map((entry) => entry.id)).toEqual(["panel", "save"]);
  });

  test("a zero-area pixel region is dropped", () => {
    expect(mergeRegions([], [region("px", { x: 0, y: 0, width: 0, height: 10 })])).toEqual([]);
  });

  test("with no accessible regions every pixel region survives", () => {
    const guessed = region("px", { x: 0, y: 0, width: 10, height: 10 });
    expect(mergeRegions([], [guessed]).map((entry) => entry.id)).toEqual(["px"]);
  });
});

describe("describeRegion", () => {
  test("names a labelled region and rounds its box", () => {
    expect(
      describeRegion(
        region("a", { x: 10.4, y: 20.6, width: 100.2, height: 30.9 }, { label: "Save" }),
      ),
    ).toBe("Save — 10,21 100×31");
  });

  test("falls back to the role, then to unlabelled", () => {
    expect(
      describeRegion(region("a", { x: 0, y: 0, width: 1, height: 1 }, { role: "push button" })),
    ).toBe("push button — 0,0 1×1");
    expect(describeRegion(region("a", { x: 0, y: 0, width: 1, height: 1 }))).toBe(
      "unlabelled — 0,0 1×1",
    );
  });
});

/**
 * The third coordinate space: what the accessibility tree answers in. A capture of a
 * 1920×1080 output at scale 2 is a 3840×2160 image, so the mapping is not the identity even
 * when the capture covers exactly one screen.
 */
describe("layout and image coordinates", () => {
  const layout = { x: 0, y: 0, width: 1920, height: 1080 };

  test("maps a layout rect into image pixels through the capture scale", () => {
    expect(layoutToImage(layout, 3840, 2160, { x: 100, y: 50, width: 200, height: 40 })).toEqual({
      x: 200,
      y: 100,
      width: 400,
      height: 80,
    });
  });

  test("subtracts the output origin, so a second monitor does not land off the picture", () => {
    const second = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(layoutToImage(second, 1920, 1080, { x: 1930, y: 10, width: 100, height: 20 })).toEqual({
      x: 10,
      y: 10,
      width: 100,
      height: 20,
    });
  });

  test("the two directions are inverses", () => {
    const original = { x: 33, y: 77, width: 120, height: 44 };
    const image = layoutToImage(layout, 3840, 2160, original)!;
    expect(imageToLayout(layout, 3840, 2160, image)).toEqual(original);
  });

  test.each([
    ["a layout box with no width", { x: 0, y: 0, width: 0, height: 1080 }, 100, 100],
    ["a layout box with no height", { x: 0, y: 0, width: 1920, height: 0 }, 100, 100],
    ["an image with no pixels", layout, 0, 100],
  ])("refuses to map through %s rather than dividing by zero", (_name, box, width, height) => {
    expect(layoutToImage(box, width, height, { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
    expect(imageToLayout(box, width, height, { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });

  test("a non-uniform capture scales each axis on its own", () => {
    expect(layoutToImage(layout, 1920, 540, { x: 0, y: 200, width: 100, height: 100 })).toEqual({
      x: 0,
      y: 100,
      width: 100,
      height: 50,
    });
  });
});

describe("clipToImage", () => {
  test("drops a region from a window on another monitor", () => {
    const inside = region("in", { x: 10, y: 10, width: 40, height: 40 });
    const outside = region("out", { x: -400, y: 10, width: 100, height: 40 });
    expect(clipToImage([inside, outside], 200, 200).map((entry) => entry.id)).toEqual(["in"]);
  });

  test("a region that only overlaps the edge is kept, not trimmed", () => {
    const overlapping = region("edge", { x: 190, y: 10, width: 40, height: 10 });
    const kept = clipToImage([overlapping], 200, 200);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.rect.width).toBe(40);
  });

  test("a region exactly at the far edge does not overlap", () => {
    expect(clipToImage([region("a", { x: 200, y: 0, width: 10, height: 10 })], 200, 200)).toEqual(
      [],
    );
  });

  test("an empty list stays empty", () => {
    expect(clipToImage([], 200, 200)).toEqual([]);
  });
});
