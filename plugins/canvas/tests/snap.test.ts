import { describe, expect, test } from "bun:test";
import { SNAP_GAP, snapToNeighbours } from "../src/engine/snap";

const placed = { x: 100, y: 100, width: 200, height: 100 };

describe("snapToNeighbours", () => {
  test("a card just off a left edge is pulled onto it", () => {
    const result = snapToNeighbours({ x: 104, y: 400, width: 200, height: 100 }, [placed], 8);

    expect(result.x).toBe(-4);
    expect(result.y).toBe(0);
    expect(result.guides).toEqual([
      { axis: "x", kind: "align", position: 100, from: 100, to: 500 },
    ]);
  });

  test("a card further off than the tolerance is left alone", () => {
    const result = snapToNeighbours({ x: 120, y: 400, width: 200, height: 100 }, [placed], 8);

    expect(result).toEqual({ x: 0, y: 0, guides: [] });
  });

  test("a centre is not an alignment: only edges are", () => {
    // The moving card's centre sits 5 off the placed card's centre, and nothing
    // else is in reach. Matching those used to pull a card that was aimed between
    // two others onto the middle of one of them.
    const result = snapToNeighbours({ x: 155, y: 400, width: 100, height: 100 }, [placed], 8);

    expect(result).toEqual({ x: 0, y: 0, guides: [] });
  });

  test("a card brought up beside another keeps the board's gutter", () => {
    const right = placed.x + placed.width + SNAP_GAP;
    const result = snapToNeighbours({ x: right - 4, y: 100, width: 60, height: 100 }, [placed], 8);

    expect(result.x).toBe(4);
    expect(result.guides).toContainEqual({
      axis: "x",
      kind: "gap",
      // A tick in the middle of the gap, across where the two cards face.
      position: placed.x + placed.width + SNAP_GAP / 2,
      from: 100,
      to: 200,
    });
  });

  test("the gutter is kept on the other side too", () => {
    const left = placed.x - SNAP_GAP - 60;
    const result = snapToNeighbours({ x: left + 3, y: 100, width: 60, height: 100 }, [placed], 8);

    expect(result.x).toBe(-3);
    expect(result.guides[0]).toMatchObject({ kind: "gap", position: placed.x - SNAP_GAP / 2 });
  });

  test("cards that are not beside each other keep no gutter", () => {
    // The same distance away, but nowhere near it vertically: there is no gap
    // between these two to hold, only an alignment, and their edges share none.
    const right = placed.x + placed.width + SNAP_GAP;
    const result = snapToNeighbours({ x: right - 4, y: 900, width: 60, height: 100 }, [placed], 8);

    expect(result).toEqual({ x: 0, y: 0, guides: [] });
  });

  test("a gutter in reach beats an alignment the same distance off", () => {
    // Held 4 to the right by the gutter beside `placed`, and 4 to the left by a
    // left edge to line up with. The gutter is the one the board arranges by.
    const gutter = placed.x + placed.width + SNAP_GAP;
    const column = { x: gutter - 8, y: 400, width: 40, height: 40 };
    const result = snapToNeighbours(
      { x: gutter - 4, y: 100, width: 40, height: 100 },
      [placed, column],
      8,
    );

    expect(result.x).toBe(4);
    expect(result.guides[0]?.kind).toBe("gap");
  });

  test("both axes snap at once, against different neighbours", () => {
    const other = { x: 600, y: 300, width: 100, height: 100 };
    const result = snapToNeighbours({ x: 98, y: 302, width: 50, height: 50 }, [placed, other], 8);

    expect(result).toMatchObject({ x: 2, y: -2 });
    expect(result.guides).toEqual([
      { axis: "x", kind: "align", position: 100, from: 100, to: 350 },
      { axis: "y", kind: "align", position: 300, from: 100, to: 700 },
    ]);
  });

  test("the nearest alignment wins when two are in reach", () => {
    const near = { x: 105, y: 400, width: 40, height: 40 };
    const result = snapToNeighbours({ x: 103, y: 900, width: 40, height: 40 }, [placed, near], 8);

    expect(result.x).toBe(2);
  });

  test("a guide spans every neighbour that shares the alignment", () => {
    const below = { x: 100, y: 600, width: 40, height: 40 };
    const result = snapToNeighbours({ x: 102, y: 300, width: 40, height: 40 }, [placed, below], 8);

    expect(result.guides[0]).toEqual({
      axis: "x",
      kind: "align",
      position: 100,
      from: 100,
      to: 640,
    });
  });

  test("an empty table pulls nothing", () => {
    expect(snapToNeighbours(placed, [], 8)).toEqual({ x: 0, y: 0, guides: [] });
  });
});
