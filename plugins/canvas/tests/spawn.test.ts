import { describe, expect, it } from "bun:test";
import { nearEdge, onPlus, plusAnchor, plusPoint } from "../src/engine/spawn";

describe("which edge is near", () => {
  it("is none over the card itself", () => {
    expect(nearEdge(100, 50, 200, 100, 1)).toBeNull();
    expect(nearEdge(1, 1, 200, 100, 1)).toBeNull();
  });

  it("is the edge the pointer is just outside of", () => {
    expect(nearEdge(100, -10, 200, 100, 1)).toBe("n");
    expect(nearEdge(210, 50, 200, 100, 1)).toBe("e");
    expect(nearEdge(100, 120, 200, 100, 1)).toBe("s");
    expect(nearEdge(-30, 50, 200, 100, 1)).toBe("w");
  });

  it("is none further out than the reach", () => {
    expect(nearEdge(100, -45, 200, 100, 1)).toBeNull();
    expect(nearEdge(260, 50, 200, 100, 1)).toBeNull();
  });

  it("past a corner, is the edge the pointer is closer to", () => {
    expect(nearEdge(-5, -20, 200, 100, 1)).toBe("w");
    expect(nearEdge(-20, -5, 200, 100, 1)).toBe("n");
  });

  it("reaches further in world units as the board zooms out", () => {
    expect(nearEdge(100, -80, 200, 100, 0.5)).toBe("n");
    expect(nearEdge(100, -80, 200, 100, 1)).toBeNull();
  });
});

describe("the button", () => {
  it("sits one gap past the edge's midpoint", () => {
    expect(plusPoint("n", 200, 100, 1)).toEqual({ x: 100, y: -16 });
    expect(plusPoint("e", 200, 100, 1)).toEqual({ x: 216, y: 50 });
    expect(plusPoint("s", 200, 100, 1)).toEqual({ x: 100, y: 116 });
    expect(plusPoint("w", 200, 100, 1)).toEqual({ x: -16, y: 50 });
  });

  it("is grabbed on itself and a little around it, and nowhere else", () => {
    expect(onPlus(216, 50, "e", 200, 100, 1)).toBe(true);
    expect(onPlus(216 + 12, 50, "e", 200, 100, 1)).toBe(true);
    expect(onPlus(216 + 20, 50, "e", 200, 100, 1)).toBe(false);
    expect(onPlus(216, 50, "n", 200, 100, 1)).toBe(false);
  });

  it("stays the same size on screen as the board zooms out", () => {
    expect(plusPoint("n", 400, 300, 0.5)).toEqual({ x: 200, y: -32 });
  });

  it("never outgrows a small card", () => {
    expect(plusPoint("n", 40, 40, 0.2)).toEqual({ x: 20, y: -10 });
  });

  it("anchors a drag at its centre in world space", () => {
    expect(plusAnchor({ x: 10, y: 20, width: 200, height: 100 }, "s", 1)).toEqual({
      x: 110,
      y: 136,
    });
  });
});
