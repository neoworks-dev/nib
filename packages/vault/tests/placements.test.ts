import { describe, expect, it } from "bun:test";
import {
  boardOf,
  flowSlot,
  overlaps,
  placementsFor,
  reconcileBoard,
  type Placement,
  type PlacementEntry,
  type Rect,
} from "../src/placements";

const size = { w: 200, h: 120 };

function entry(path: string, id: string | null = null): PlacementEntry {
  return { path, id };
}

function at(x: number, y: number, z = 1, id?: string): Placement {
  const placement: Placement = { x, y, w: 200, h: 120, z };
  if (id !== undefined) placement.id = id;
  return placement;
}

describe("reconcileBoard", () => {
  it("places everything when nothing is stored yet", () => {
    const result = reconcileBoard([entry("a.md"), entry("b.md")], {}, { size });
    expect(result.added).toEqual(["a.md", "b.md"]);
    expect(result.removed).toEqual([]);
    expect(result.placements["a.md"]).toEqual({ x: 0, y: 0, w: 200, h: 120, z: 1 });
    expect(result.placements["b.md"]?.x).not.toBe(0);
  });

  it("never places two objects on top of each other", () => {
    const entries = [entry("a.md"), entry("b.md"), entry("c.md"), entry("d.md"), entry("e.md")];
    const { placements } = reconcileBoard(entries, {}, { size });
    const rects = Object.values(placements);
    for (const [index, left] of rects.entries()) {
      for (const right of rects.slice(index + 1)) {
        expect(overlaps(left, right)).toBe(false);
      }
    }
  });

  it("keeps a stored position and gives it no new one", () => {
    const stored = { "a.md": at(40, 60, 7) };
    const result = reconcileBoard([entry("a.md")], stored, { size });
    expect(result.added).toEqual([]);
    expect(result.placements["a.md"]).toEqual({ x: 40, y: 60, w: 200, h: 120, z: 7 });
  });

  it("drops a position for a path that is gone", () => {
    const result = reconcileBoard([entry("a.md")], { "gone.md": at(0, 0) }, { size });
    expect(result.removed).toEqual(["gone.md"]);
    expect(result.placements["gone.md"]).toBeUndefined();
  });

  it("carries a position across a rename that declared an id", () => {
    const stored = { "old.md": at(40, 60, 3, "note-1") };
    const result = reconcileBoard([entry("new.md", "note-1")], stored, { size });
    expect(result.carried).toEqual(["new.md"]);
    expect(result.added).toEqual([]);
    expect(result.placements["new.md"]).toEqual({
      x: 40,
      y: 60,
      w: 200,
      h: 120,
      z: 3,
      id: "note-1",
    });
    expect(result.removed).toEqual(["old.md"]);
  });

  it("does not carry without an id", () => {
    const stored = { "old.md": at(40, 60, 3) };
    const result = reconcileBoard([entry("new.md")], stored, { size });
    expect(result.carried).toEqual([]);
    expect(result.added).toEqual(["new.md"]);
  });

  it("gives a carried position to one path only", () => {
    const stored = { "old.md": at(40, 60, 3, "note-1") };
    const result = reconcileBoard([entry("new.md", "note-1"), entry("old.md", "note-1")], stored, {
      size,
    });
    expect(result.placements["new.md"]).toEqual({
      x: 40,
      y: 60,
      w: 200,
      h: 120,
      z: 3,
      id: "note-1",
    });
    expect(result.carried).toEqual(["new.md"]);
    expect(result.added).toEqual(["old.md"]);
    expect(result.placements["old.md"]?.x).not.toBe(40);
  });

  it("keeps the path's own position when a rename also happened", () => {
    const stored = { "old.md": at(40, 60, 3, "note-1"), "new.md": at(400, 600, 9, "note-2") };
    const result = reconcileBoard([entry("new.md", "note-2")], stored, { size });
    expect(result.placements["new.md"]).toEqual({
      x: 400,
      y: 600,
      w: 200,
      h: 120,
      z: 9,
      id: "note-2",
    });
    expect(result.carried).toEqual([]);
  });

  it("lets the caller choose the slot", () => {
    const slot = (): { x: number; y: number } => ({ x: 12, y: 34 });
    const { placements } = reconcileBoard([entry("a.md")], {}, { size, slot });
    expect(placements["a.md"]).toEqual({ x: 12, y: 34, w: 200, h: 120, z: 1 });
  });

  it("stacks new objects above what is already there", () => {
    const slot = (): { x: number; y: number } => ({ x: 0, y: 0 });
    const { placements } = reconcileBoard([entry("a.md"), entry("b.md")], {}, { size, slot });
    expect(placements["a.md"]?.z).toBe(1);
    expect(placements["b.md"]?.z).toBe(2);
  });
});

describe("flowSlot", () => {
  it("steps along a row before wrapping", () => {
    const slot = flowSlot({ maxWidth: 1000, gap: 24 });
    expect(slot([], { w: 200, h: 120 })).toEqual({ x: 0, y: 0 });
    expect(slot([{ x: 0, y: 0, w: 200, h: 120 }], { w: 200, h: 120 })).toEqual({ x: 224, y: 0 });
  });

  it("wraps to a new row when the row is full", () => {
    const slot = flowSlot({ maxWidth: 500, gap: 24 });
    const first: Rect = { x: 0, y: 0, w: 200, h: 120 };
    expect(slot([first], { w: 200, h: 120 })).toEqual({ x: 224, y: 0 });

    const second: Rect = { x: 224, y: 0, w: 200, h: 300 };
    const wrapped = slot([first, second], { w: 200, h: 120 });
    expect(wrapped.y).toBeGreaterThan(0);
    expect(overlaps({ ...wrapped, w: 200, h: 120 }, first)).toBe(false);
    expect(overlaps({ ...wrapped, w: 200, h: 120 }, second)).toBe(false);
  });

  it("handles mixed sizes without overlapping", () => {
    const slot = flowSlot({ maxWidth: 400, gap: 10 });
    const sizes = [
      { w: 120, h: 80 },
      { w: 300, h: 200 },
      { w: 90, h: 400 },
      { w: 200, h: 120 },
      { w: 60, h: 60 },
    ];
    const occupied: Rect[] = [];
    for (const size of sizes) {
      const spot = slot(occupied, size);
      const rect: Rect = { ...spot, ...size };
      for (const other of occupied) expect(overlaps(rect, other)).toBe(false);
      occupied.push(rect);
    }
    expect(occupied).toHaveLength(sizes.length);
  });

  it("never returns a spot that overlaps an existing object", () => {
    const slot = flowSlot({ maxWidth: 200 });
    const first: Rect = { x: 0, y: 0, w: 200, h: 120 };
    const second: Rect = { x: 0, y: 144, w: 200, h: 120 };
    const spot = slot([first, second], { w: 200, h: 120 });
    const placed: Rect = { ...spot, w: 200, h: 120 };

    expect(overlaps(placed, first)).toBe(false);
    expect(overlaps(placed, second)).toBe(false);
  });
});

describe("placementsFor", () => {
  it("reads a board's slice, and reads a board with none as empty", () => {
    const map = { "topic-x": { "topic-x/a.md": at(0, 0) } };
    expect(Object.keys(placementsFor(map, "topic-x"))).toEqual(["topic-x/a.md"]);
    expect(placementsFor(map, "")).toEqual({});
  });
});

describe("boardOf", () => {
  it("is the path's directory, and empty at the vault root", () => {
    expect(boardOf("a.md")).toBe("");
    expect(boardOf("topic-x")).toBe("");
    expect(boardOf("topic-x/a.md")).toBe("topic-x");
    expect(boardOf("topic-x/sub/b.md")).toBe("topic-x/sub");
  });
});

describe("overlaps", () => {
  it("is false for rects that only touch", () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
  });

  it("is true for rects that share any area", () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 10, h: 10 })).toBe(true);
  });
});
