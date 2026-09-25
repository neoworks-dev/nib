import { describe, expect, it } from "bun:test";
import { lineageCurve, parseLineage } from "../src/lineage";

const source = { x: 0, y: 0, width: 200, height: 100 };

describe("lineageCurve", () => {
  it("runs from the source's right edge to the result's left edge when the result is to the right", () => {
    expect(lineageCurve(source, { x: 300, y: 0, width: 200, height: 100 })).toEqual({
      start: { x: 200, y: 50 },
      startHandle: { x: 250, y: 50 },
      endHandle: { x: 250, y: 50 },
      end: { x: 300, y: 50 },
    });
  });

  it("runs leftward from the source's left edge, with the handles reaching at least a little", () => {
    const curve = lineageCurve(source, { x: -230, y: 40, width: 200, height: 100 });
    expect(curve.start).toEqual({ x: 0, y: 50 });
    expect(curve.end).toEqual({ x: -30, y: 90 });
    expect(curve.startHandle).toEqual({ x: -40, y: 50 });
    expect(curve.endHandle).toEqual({ x: 10, y: 90 });
  });

  it("runs from bottom to top when the result sits below", () => {
    const curve = lineageCurve(source, { x: 20, y: 400, width: 200, height: 100 });
    expect(curve.start).toEqual({ x: 100, y: 100 });
    expect(curve.end).toEqual({ x: 120, y: 400 });
    expect(curve.startHandle).toEqual({ x: 100, y: 250 });
  });
});

describe("parseLineage", () => {
  it("reads a lineage object and refuses anything else", () => {
    const link = { kind: "comfy-lineage" as const, id: "l1", from: "a.png", to: "b.png" };
    expect(parseLineage(link)).toEqual(link);
    expect(parseLineage({ ...link, to: 3 })).toBeNull();
    expect(parseLineage({ ...link, kind: "edge" })).toBeNull();
    expect(parseLineage(null)).toBeNull();
  });
});
