import { describe, expect, it } from "bun:test";
import {
  boardOf,
  flowSlot,
  overlaps,
  packSlot,
  parsePlacements,
  parseStacks,
  placementsFor,
  reconcileBoard,
  renamePlacements,
  type Placement,
  type PlacementEntry,
  type Rect,
} from "../src/placements";

const size = { w: 200, h: 120 };

function entry(path: string, id: string | null = null): PlacementEntry {
  return { path, id };
}

/** A placement that has to be there, so a test can read it without asserting. */
function placed(placements: Record<string, Placement>, path: string): Rect {
  const placement = placements[path];
  if (!placement) throw new Error(`no placement for ${path}`);
  return placement;
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

  it("does not put a new object on a spot a later entry already owns", () => {
    // `b.md` is stored but comes after `a.md`, which has no position yet. Slotting
    // in one pass hands `a.md` the origin without knowing `b.md` is already there,
    // and the two end up on the same rectangle.
    const result = reconcileBoard([entry("a.md"), entry("b.md")], { "b.md": at(0, 0) }, { size });
    expect(result.placements["b.md"]).toEqual({ x: 0, y: 0, w: 200, h: 120, z: 1 });
    expect(overlaps(placed(result.placements, "a.md"), placed(result.placements, "b.md"))).toBe(
      false,
    );
  });

  it("re-slots a stored position that duplicates one already claimed", () => {
    // Two cards on the exact same rectangle is what the one-pass bug wrote out:
    // nobody can drag a card onto another's precise spot, and the lower one could
    // never be reached to move it off again.
    const stored = { "a.md": at(80, 80), "b.md": at(80, 80) };
    const result = reconcileBoard([entry("a.md"), entry("b.md")], stored, { size });
    expect(result.placements["a.md"]).toEqual({ x: 80, y: 80, w: 200, h: 120, z: 1 });
    expect(result.added).toEqual(["b.md"]);
    expect(overlaps(placed(result.placements, "a.md"), placed(result.placements, "b.md"))).toBe(
      false,
    );
  });

  it("leaves a pile's coincident members alone", () => {
    // A cascade stops stepping past its limit, so the cards at the bottom of a
    // deep pile sit on exactly the same rectangle on purpose. Re-slotting one
    // throws it out of the stack the user built and drops it across the board.
    const piled = (x: number, y: number): Placement => ({
      x,
      y,
      w: 200,
      h: 120,
      z: 1,
      stack: "s1",
    });
    const stored = { "a.md": piled(80, 80), "b.md": piled(80, 80) };
    const result = reconcileBoard([entry("a.md"), entry("b.md")], stored, {
      size,
      stacks: { s1: { x: 80, y: 80, w: 200, h: 120 } },
    });

    expect(result.added).toEqual([]);
    expect(result.placements["b.md"]).toEqual(piled(80, 80));
    expect(Object.keys(result.stacks)).toEqual(["s1"]);
  });

  it("leaves cards that merely overlap where they are", () => {
    // Overlap is a real arrangement — a card can be dragged half over another —
    // so only an exact duplicate counts as the bug's residue.
    const stored = { "a.md": at(0, 0), "b.md": at(20, 20) };
    const result = reconcileBoard([entry("a.md"), entry("b.md")], stored, { size });
    expect(result.added).toEqual([]);
    expect(result.placements["b.md"]).toEqual({ x: 20, y: 20, w: 200, h: 120, z: 1 });
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

describe("stacks", () => {
  /** A placement that is in a pile. */
  function piled(x: number, y: number, stack: string): Placement {
    return { x, y, w: 200, h: 120, z: 1, stack };
  }

  it("keeps a pile that still holds something", () => {
    const result = reconcileBoard(
      [entry("a.md"), entry("b.md")],
      { "a.md": piled(0, 0, "s1"), "b.md": piled(4, 4, "s1") },
      { size, stacks: { s1: { x: 0, y: 0, w: 200, h: 120 } } },
    );

    expect(result.stacks).toEqual({ s1: { x: 0, y: 0, w: 200, h: 120 } });
    expect(result.placements["a.md"]?.stack).toBe("s1");
  });

  it("keeps a pile that has lost some of its members but not all", () => {
    const result = reconcileBoard(
      [entry("a.md")],
      { "a.md": piled(0, 0, "s1"), "b.md": piled(4, 4, "s1") },
      { size, stacks: { s1: { x: 0, y: 0, w: 200, h: 120 } } },
    );

    expect(result.removed).toEqual(["b.md"]);
    expect(Object.keys(result.stacks)).toEqual(["s1"]);
  });

  it("drops a pile whose every member is gone", () => {
    const result = reconcileBoard(
      [entry("c.md")],
      { "a.md": piled(0, 0, "s1"), "b.md": piled(4, 4, "s1") },
      { size, stacks: { s1: { x: 0, y: 0, w: 200, h: 120 } } },
    );

    expect(result.stacks).toEqual({});
  });

  it("rebuilds a pile whose rectangle the document lost", () => {
    // Membership is on the placements, so an empty stack map is a missing
    // rectangle and not a dissolved pile: dissolving here left every card of a
    // stack sitting in its cascade with nothing that answered a click.
    const result = reconcileBoard(
      [entry("a.md"), entry("b.md")],
      { "a.md": { ...piled(30, 40, "s1"), z: 2 }, "b.md": piled(23, 33, "s1") },
      { size, stacks: {} },
    );

    expect(result.placements["a.md"]?.stack).toBe("s1");
    expect(result.placements["b.md"]?.stack).toBe("s1");
    // The pile sits where its top card does, which is what folding one put there.
    expect(result.stacks).toEqual({ s1: { x: 30, y: 40, w: 200, h: 120 } });
  });

  it("reads a pile back when the caller passes no map at all", () => {
    const result = reconcileBoard([entry("a.md")], { "a.md": piled(30, 40, "s1") }, { size });

    expect(result.stacks).toEqual({ s1: { x: 30, y: 40, w: 200, h: 120 } });
  });

  it("prefers the stored rectangle to the one its top card is on", () => {
    // The pile stays put while cards are dragged out of it, so where it was
    // folded outlives any one member's position.
    const result = reconcileBoard(
      [entry("a.md")],
      { "a.md": piled(30, 40, "s1") },
      { size, stacks: { s1: { x: 0, y: 0, w: 200, h: 120 } } },
    );

    expect(result.stacks).toEqual({ s1: { x: 0, y: 0, w: 200, h: 120 } });
  });

  it("does not edit the map it was handed", () => {
    const stored = { "a.md": piled(30, 40, "s1") };
    reconcileBoard([entry("a.md")], stored, { size, stacks: {} });

    expect(stored["a.md"].stack).toBe("s1");
  });

  it("reports no piles for a board that has none", () => {
    expect(reconcileBoard([entry("a.md")], {}, { size }).stacks).toEqual({});
  });
});

describe("parseStacks", () => {
  it("reads a stored map", () => {
    expect(parseStacks({ s1: { x: 1, y: 2, w: 3, h: 4 } })).toEqual({
      s1: { x: 1, y: 2, w: 3, h: 4 },
    });
  });

  it("drops an entry with no usable rectangle", () => {
    expect(
      parseStacks({
        good: { x: 0, y: 0, w: 10, h: 10 },
        noSize: { x: 0, y: 0, w: 0, h: 10 },
        notNumbers: { x: "a", y: 0, w: 10, h: 10 },
        missing: { x: 0, y: 0 },
      }),
    ).toEqual({ good: { x: 0, y: 0, w: 10, h: 10 } });
  });

  it("reads anything unusable as nothing at all", () => {
    expect(parseStacks(null)).toEqual({});
    expect(parseStacks([])).toEqual({});
    expect(parseStacks("nope")).toEqual({});
  });
});

describe("parsePlacements", () => {
  it("keeps a stack id, and drops an empty one", () => {
    expect(parsePlacements({ "": { "a.md": { x: 0, y: 0, w: 1, h: 1, stack: "s1" } } })).toEqual({
      "": { "a.md": { x: 0, y: 0, w: 1, h: 1, z: 0, stack: "s1" } },
    });
    expect(parsePlacements({ "": { "a.md": { x: 0, y: 0, w: 1, h: 1, stack: "" } } })).toEqual({
      "": { "a.md": { x: 0, y: 0, w: 1, h: 1, z: 0 } },
    });
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

  it("sits a narrow card beside a wider one rather than below it", () => {
    // The regression: stepping by the incoming card's width lands it back inside
    // the wider card, the scan walks off the right edge, and the row wraps with
    // the space beside the picture left empty. This is a folder preview holding a
    // picture and a sheet — the layout from the screenshot that showed the hole.
    const slot = flowSlot({ maxWidth: 720, gap: 24 });
    const picture: Rect = { x: 0, y: 0, w: 340, h: 230 };
    expect(slot([picture], { w: 300, h: 400 })).toEqual({ x: 364, y: 0 });
  });

  it("tucks a card under a short neighbour instead of below the tallest", () => {
    // Descending by the tallest card in the row would step past the picture's
    // bottom edge and leave the space under it unreachable.
    const slot = flowSlot({ maxWidth: 720, gap: 24 });
    const picture: Rect = { x: 0, y: 0, w: 340, h: 230 };
    const sheet: Rect = { x: 364, y: 0, w: 300, h: 400 };
    expect(slot([picture, sheet], { w: 300, h: 400 })).toEqual({ x: 0, y: 254 });
  });

  it("leaves no card further down than it has to be", () => {
    // Every card packed into a block should land inside the bounding box the
    // block would have if it were packed by hand — no 400-unit holes.
    const slot = flowSlot({ maxWidth: 720, gap: 24 });
    const sizes = [
      { w: 340, h: 230 },
      { w: 300, h: 400 },
      { w: 300, h: 400 },
      { w: 288, h: 168 },
    ];
    const occupied: Rect[] = [];
    for (const size of sizes) {
      const spot = slot(occupied, size);
      occupied.push({ ...spot, ...size });
    }

    const bottom = Math.max(...occupied.map((rect) => rect.y + rect.h));
    expect(bottom).toBeLessThanOrEqual(700);
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

describe("parsePlacements", () => {
  it("reads a stored map", () => {
    const parsed = parsePlacements({ "": { "a.md": { x: 1, y: 2, w: 3, h: 4, z: 5 } } });
    expect(parsed).toEqual({ "": { "a.md": { x: 1, y: 2, w: 3, h: 4, z: 5 } } });
  });

  it("keeps an id, and drops an empty one", () => {
    const withId = parsePlacements({ "": { "a.md": { x: 0, y: 0, w: 1, h: 1, z: 0, id: "n-1" } } });
    expect(withId[""]?.["a.md"]?.id).toBe("n-1");
    const empty = parsePlacements({ "": { "a.md": { x: 0, y: 0, w: 1, h: 1, z: 0, id: "" } } });
    expect(empty[""]?.["a.md"]?.id).toBeUndefined();
  });

  it("defaults a missing z", () => {
    const parsed = parsePlacements({ "": { "a.md": { x: 0, y: 0, w: 1, h: 1 } } });
    expect(parsed[""]?.["a.md"]?.z).toBe(0);
  });

  it("drops anything that could not be drawn", () => {
    const parsed = parsePlacements({
      "": {
        "no-geometry.md": { z: 1 },
        "nan.md": { x: Number.NaN, y: 0, w: 1, h: 1, z: 0 },
        "zero.md": { x: 0, y: 0, w: 0, h: 10, z: 0 },
        "negative.md": { x: 0, y: 0, w: -5, h: 10, z: 0 },
        "fine.md": { x: 0, y: 0, w: 1, h: 1, z: 0 },
      },
    });
    expect(Object.keys(parsed[""] ?? {})).toEqual(["fine.md"]);
  });

  it("reads anything unusable as nothing at all", () => {
    expect(parsePlacements(null)).toEqual({});
    expect(parsePlacements([])).toEqual({});
    expect(parsePlacements("nope")).toEqual({});
    expect(parsePlacements({ "": "nope" })).toEqual({});
    expect(parsePlacements({ "": {} })).toEqual({});
    expect(parsePlacements({ "": { "a.md": { z: 1 } } })).toEqual({});
  });
});

describe("packSlot", () => {
  it("puts the first card at the origin and the next beside it", () => {
    const slot = packSlot({ maxWidth: 1000, gap: 24 });
    expect(slot([], { w: 200, h: 120 })).toEqual({ x: 0, y: 0 });
    expect(slot([{ x: 0, y: 0, w: 200, h: 120 }], { w: 200, h: 120 })).toEqual({ x: 224, y: 0 });
  });

  it("drops a card onto the shortest thing it can reach rather than onto a row", () => {
    const slot = packSlot({ maxWidth: 720, gap: 24 });
    const picture: Rect = { x: 0, y: 0, w: 340, h: 230 };
    const sheet: Rect = { x: 364, y: 0, w: 300, h: 400 };
    // Under the picture, which is 170 shorter than the sheet beside it.
    expect(slot([picture, sheet], { w: 300, h: 300 })).toEqual({ x: 0, y: 254 });
  });

  it("never overlaps, whatever the sizes", () => {
    const slot = packSlot({ maxWidth: 400, gap: 10 });
    const sizes = [
      { w: 120, h: 80 },
      { w: 300, h: 200 },
      { w: 90, h: 400 },
      { w: 200, h: 120 },
      { w: 60, h: 60 },
    ];
    const occupied: Rect[] = [];
    for (const size of sizes) {
      const rect: Rect = { ...slot(occupied, size), ...size };
      for (const other of occupied) expect(overlaps(rect, other)).toBe(false);
      occupied.push(rect);
    }
    expect(occupied).toHaveLength(sizes.length);
  });

  it("puts a card too wide for the block below everything", () => {
    const slot = packSlot({ maxWidth: 300, gap: 24 });
    const placed: Rect = { x: 0, y: 0, w: 300, h: 100 };
    expect(slot([placed], { w: 400, h: 100 })).toEqual({ x: 0, y: 124 });
  });
});

describe("renamePlacements", () => {
  const at: Placement = { x: 1, y: 2, w: 3, h: 4, z: 1 };

  it("moves the entry's own placement, the board inside it and those nested in it", () => {
    const map = {
      "": { notes: at, other: at },
      notes: { "notes/a.md": at },
      "notes/deep": { "notes/deep/b.md": at },
      notebook: { "notebook/c.md": at },
    };

    expect(renamePlacements(map, "notes", "journal")).toEqual({
      "": { journal: at, other: at },
      journal: { "journal/a.md": at },
      "journal/deep": { "journal/deep/b.md": at },
      notebook: { "notebook/c.md": at },
    });
  });
});
