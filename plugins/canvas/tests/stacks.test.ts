import { describe, expect, it } from "bun:test";
import type { Placement } from "@nib-ui/vault";
import {
  arrangeGrid,
  boundsOf,
  CASCADE_STEP,
  collapse,
  createStackId,
  dissolve,
  membersOf,
  release,
  spread,
  type StackMember,
} from "../src/stacks";

function member(path: string, x: number, y: number, z = 1): StackMember {
  return { path, placement: { x, y, w: 100, h: 100, z } };
}

describe("collapse", () => {
  const members = [member("a.md", 0, 0), member("b.md", 400, 0), member("c.md", 0, 400)];

  it("refuses fewer than two: one card in a stack is just a card", () => {
    expect(collapse([member("a.md", 0, 0)], "s1")).toBeNull();
    expect(collapse([], "s1")).toBeNull();
  });

  it("puts the pile at the centre of what the selection covered", () => {
    const folded = collapse(members, "s1");
    if (!folded) throw new Error("expected a pile");

    // The three cards span 0..500 on both axes, so the centre is 250,250 and a
    // 100-wide card sits at 200,200.
    expect(folded.rect).toEqual({ x: 200, y: 200, w: 100, h: 100 });
  });

  it("puts the largest card at the back and the smallest on top", () => {
    const folded = collapse([member("a.md", 0, 0), { path: "b.md", placement: wide() }], "s1");
    if (!folded) throw new Error("expected a pile");

    const order = Object.entries(folded.placements).sort((left, right) => left[1].z - right[1].z);
    expect(order.map((entry) => entry[0])).toEqual(["b.md", "a.md"]);
    // The top card sits exactly on the pile's own rectangle.
    expect(folded.placements["a.md"]).toMatchObject({ x: folded.rect.x, y: folded.rect.y });
  });

  it("piles the same way however the cards were laid out before it", () => {
    const scattered = [member("b.md", 900, 40), member("c.md", 20, 700), member("a.md", 300, 10)];
    const order = (folded: ReturnType<typeof collapse>): string[] => {
      if (!folded) throw new Error("expected a pile");
      return Object.entries(folded.placements)
        .sort((left, right) => left[1].z - right[1].z)
        .map((entry) => entry[0]);
    };

    // Same cards, same sizes, different positions: an order read off where they
    // sat gave a different pile every time one was spread and folded again.
    expect(order(collapse(scattered, "s1"))).toEqual(order(collapse(members, "s1")));
  });

  it("cascades up and to the left, one step per layer, with no rotation", () => {
    const folded = collapse(members, "s1");
    if (!folded) throw new Error("expected a pile");

    const byDepth = Object.values(folded.placements).sort((left, right) => right.z - left.z);
    expect(byDepth[1]).toMatchObject({
      x: folded.rect.x - CASCADE_STEP,
      y: folded.rect.y - CASCADE_STEP,
    });
    expect(byDepth[2]).toMatchObject({
      x: folded.rect.x - CASCADE_STEP * 2,
      y: folded.rect.y - CASCADE_STEP * 2,
    });
  });

  it("makes every member a member", () => {
    const folded = collapse(members, "s1");
    if (!folded) throw new Error("expected a pile");

    for (const placement of Object.values(folded.placements)) expect(placement.stack).toBe("s1");
  });

  it("keeps each card's own size: piling is not resizing", () => {
    const mixed = [member("a.md", 0, 0), { path: "b.md", placement: wide() }];
    const folded = collapse(mixed, "s1");
    if (!folded) throw new Error("expected a pile");

    expect(folded.placements["b.md"]).toMatchObject({ w: 300, h: 200 });
    expect(folded.placements["a.md"]).toMatchObject({ w: 100, h: 100 });
  });
});

describe("spread", () => {
  const rect = { x: 200, y: 200, w: 100, h: 100 };
  const members = [member("a.md", 200, 200, 1), member("b.md", 193, 193, 2)];

  it("lays the members out without overlapping", () => {
    const out = spread(members, rect);
    const a = out["a.md"];
    const b = out["b.md"];
    if (!a || !b) throw new Error("expected both");

    const apart = Math.abs(a.x - b.x) >= a.w || Math.abs(a.y - b.y) >= a.h;
    expect(apart).toBe(true);
  });

  it("keeps them in the pile: a spread stack is still a stack", () => {
    const out = spread(
      members.map((entry) => ({ ...entry, placement: { ...entry.placement, stack: "s1" } })),
      rect,
    );

    for (const placement of Object.values(out)) expect(placement.stack).toBe("s1");
  });

  it("opens out from where the pile was, not off to one side of it", () => {
    const out = spread(members, rect);
    const covered = boundsOf(Object.values(out));
    if (!covered) throw new Error("expected a box");

    expect(covered.x + covered.w / 2).toBeCloseTo(rect.x + rect.w / 2, 0);
    expect(covered.y + covered.h / 2).toBeCloseTo(rect.y + rect.h / 2, 0);
  });

  it("is empty for a pile with nothing in it", () => {
    expect(spread([], rect)).toEqual({});
  });
});

describe("dissolve", () => {
  const placements: Record<string, Placement> = {
    "a.md": { x: 0, y: 0, w: 100, h: 100, z: 1, stack: "s1" },
    "b.md": { x: 7, y: 7, w: 100, h: 100, z: 2, stack: "s1" },
    "c.md": { x: 400, y: 0, w: 100, h: 100, z: 3, stack: "s2" },
  };

  it("takes only the named pile apart and leaves the cards where they are", () => {
    const out = dissolve(
      placements,
      { s1: { x: 0, y: 0, w: 1, h: 1 }, s2: { x: 0, y: 0, w: 1, h: 1 } },
      "s1",
    );

    expect(out.placements["a.md"]).toEqual({ x: 0, y: 0, w: 100, h: 100, z: 1 });
    expect(out.placements["b.md"]?.stack).toBeUndefined();
    expect(out.placements["c.md"]?.stack).toBe("s2");
    expect(Object.keys(out.stacks)).toEqual(["s2"]);
  });

  it("does not edit the map it was handed", () => {
    dissolve(placements, { s1: { x: 0, y: 0, w: 1, h: 1 } }, "s1");

    expect(placements["a.md"]?.stack).toBe("s1");
  });
});

describe("membersOf", () => {
  it("reads a pile bottom first, and knows nothing of the others", () => {
    const placements: Record<string, Placement> = {
      "a.md": { x: 0, y: 0, w: 1, h: 1, z: 2, stack: "s1" },
      "b.md": { x: 0, y: 0, w: 1, h: 1, z: 1, stack: "s1" },
      "c.md": { x: 0, y: 0, w: 1, h: 1, z: 9 },
    };

    expect(membersOf(placements, "s1").map((entry) => entry.path)).toEqual(["b.md", "a.md"]);
  });
});

describe("release", () => {
  const stacks = { s1: { x: 0, y: 0, w: 100, h: 100 } };

  it("lets a card dragged clear of its pile go, and keeps one dropped back on it", () => {
    const placements: Record<string, Placement> = {
      "a.md": { x: 0, y: 0, w: 100, h: 100, z: 1, stack: "s1" },
      "b.md": { x: 7, y: 7, w: 100, h: 100, z: 2, stack: "s1" },
      "c.md": { x: 500, y: 0, w: 100, h: 100, z: 3, stack: "s1" },
    };

    const released = release(placements, stacks, ["c.md", "b.md"]);
    expect(released.placements["c.md"]?.stack).toBeUndefined();
    expect(released.placements["b.md"]?.stack).toBe("s1");
    expect(released.stacks["s1"]).toBeDefined();
  });

  it("takes a pile apart when a leaver would leave it one card", () => {
    const placements: Record<string, Placement> = {
      "a.md": { x: 0, y: 0, w: 100, h: 100, z: 1, stack: "s1" },
      "b.md": { x: 500, y: 0, w: 100, h: 100, z: 2, stack: "s1" },
    };

    const released = release(placements, stacks, ["b.md"]);
    expect(released.placements["a.md"]?.stack).toBeUndefined();
    expect(released.placements["b.md"]?.stack).toBeUndefined();
    expect(released.stacks["s1"]).toBeUndefined();
  });

  it("leaves a card that is in no pile alone", () => {
    const placements: Record<string, Placement> = { "a.md": { x: 0, y: 0, w: 1, h: 1, z: 1 } };
    expect(release(placements, {}, ["a.md"]).placements).toEqual(placements);
  });
});

describe("arrangeGrid", () => {
  it("lays cards out in reading order from the top left of where they were", () => {
    const members = [
      member("c.md", 900, 40),
      member("a.md", 100, 50),
      member("d.md", 100, 700),
      member("b.md", 500, 60),
    ];

    const grid = arrangeGrid(members, 16);
    // Four cards: two columns, each card a gap after the last.
    expect(grid["a.md"]).toMatchObject({ x: 100, y: 40 });
    expect(grid["b.md"]).toMatchObject({ x: 216, y: 40 });
    expect(grid["c.md"]).toMatchObject({ x: 100, y: 156 });
    expect(grid["d.md"]).toMatchObject({ x: 216, y: 156 });
  });

  it("packs mixed sizes into columns: the next card goes under the shortest one", () => {
    const small: StackMember = { path: "s.md", placement: { x: 0, y: 0, w: 50, h: 30, z: 1 } };
    const tall: StackMember = { path: "t.md", placement: { x: 300, y: 0, w: 80, h: 200, z: 1 } };
    const third: StackMember = { path: "u.md", placement: { x: 600, y: 0, w: 60, h: 60, z: 1 } };

    // A column is as wide as its own widest card, so the second starts a gap after
    // the 60 in the first rather than after the 80 that is not in it.
    const grid = arrangeGrid([small, tall, third], 16);
    expect(grid["s.md"]).toMatchObject({ x: 0, y: 0 });
    expect(grid["t.md"]).toMatchObject({ x: 76, y: 0 });
    // Under the short card rather than in a row cut for the tall one.
    expect(grid["u.md"]).toMatchObject({ x: 0, y: 46 });
  });

  it("keeps the gap between neighbours, whatever the widest card is", () => {
    const narrow: StackMember = { path: "n.md", placement: { x: 0, y: 0, w: 100, h: 40, z: 1 } };
    const wide: StackMember = { path: "w.md", placement: { x: 400, y: 0, w: 600, h: 40, z: 1 } };
    const grid = arrangeGrid([narrow, wide], 32);

    const left = grid["n.md"];
    const right = grid["w.md"];
    if (!left || !right) throw new Error("expected both");
    expect(right.x - (left.x + left.w)).toBe(32);
  });

  it("keeps each card's size and depth", () => {
    const grid = arrangeGrid([member("a.md", 0, 0, 4), member("b.md", 300, 0, 2)]);
    expect(grid["a.md"]).toMatchObject({ w: 100, h: 100, z: 4 });
    expect(grid["b.md"]).toMatchObject({ x: 132, z: 2 });
  });
});

describe("createStackId", () => {
  it("never answers the same thing twice", () => {
    expect(createStackId()).not.toBe(createStackId());
  });
});

function wide(): Placement {
  return { x: 400, y: 400, w: 300, h: 200, z: 2 };
}
