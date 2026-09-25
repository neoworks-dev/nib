import { describe, expect, it } from "bun:test";
import type { PlacementMap } from "@nib-ui/vault";
import { resultSlot, slotPlacements } from "../src/lib/server/comfyui-slot";

const sprite = { x: 0, y: 0, w: 200, h: 100, z: 1 };

describe("resultSlot", () => {
  it("sits right of the reference, at its size", () => {
    const placements: PlacementMap = { art: { "art/sprite.png": sprite } };
    expect(resultSlot(placements, "art", "art/sprite.png", [])).toEqual({
      board: "art",
      x: 232,
      y: 0,
      w: 200,
      h: 100,
    });
  });

  it("steps past a card and a spot held for another run", () => {
    const placements: PlacementMap = {
      art: { "art/sprite.png": sprite, "art/note.md": { x: 240, y: 20, w: 100, h: 100, z: 2 } },
    };
    const held = [{ board: "art", x: 372, y: 0, w: 200, h: 100 }];
    const elsewhere = [{ board: "", x: 604, y: 0, w: 200, h: 100 }];
    expect(resultSlot(placements, "art", "art/sprite.png", [...held, ...elsewhere])).toMatchObject({
      x: 604,
      y: 0,
    });
  });

  it("sits at the point it was asked for, at the reference's size", () => {
    const placements: PlacementMap = { art: { "art/sprite.png": sprite } };
    expect(resultSlot(placements, "art", "art/sprite.png", [], { x: 500, y: 400 })).toEqual({
      board: "art",
      x: 500,
      y: 400,
      w: 200,
      h: 100,
    });
  });

  it("moves off a card covering the point by the shortest way", () => {
    const tall: PlacementMap = { "": { "note.md": { x: 0, y: -500, w: 100, h: 1000, z: 1 } } };
    expect(resultSlot(tall, "", null, [], { x: 50, y: 50 })).toEqual({
      board: "",
      x: 132,
      y: 50,
      w: 340,
      h: 340,
    });
    const square: PlacementMap = { "": { "note.md": { x: 0, y: 0, w: 100, h: 100, z: 1 } } };
    expect(resultSlot(square, "", null, [], { x: 50, y: 50 })).toMatchObject({ x: 50, y: 132 });
  });

  it("slides left past a card that fills the space right of and below the point", () => {
    const placements: PlacementMap = {
      "": { "session.jsonl": { x: 930, y: 560, w: 300, h: 420, z: 1 } },
    };
    expect(resultSlot(placements, "", null, [], { x: 700, y: 480 })).toMatchObject({
      x: 558,
      y: 480,
    });
  });

  it("takes a free row near the point over a far spot in a crowded one", () => {
    const cards = Array.from({ length: 10 }, (_, index) => [
      `card-${index}.png`,
      { x: index * 400, y: 0, w: 380, h: 340, z: 1 },
    ]);
    const row: PlacementMap = { "": Object.fromEntries(cards) };
    expect(resultSlot(row, "", null, [], { x: 0, y: 0 })).toMatchObject({ x: 0, y: 372 });
  });

  it("takes the board's next flow slot without a placed reference", () => {
    const placements: PlacementMap = { comfyui: { "comfyui/a.png": { ...sprite, w: 340 } } };
    expect(resultSlot(placements, "comfyui", null, [])).toEqual({
      board: "comfyui",
      x: 364,
      y: 0,
      w: 340,
      h: 340,
    });
    expect(resultSlot({}, "", "elsewhere/sprite.png", [])).toMatchObject({ board: "", x: 0, y: 0 });
  });
});

describe("slotPlacements", () => {
  it("puts the first output in the slot and the rest in a row", () => {
    const slot = { board: "art", x: 10, y: 20, w: 100, h: 50 };
    const outputs = [
      { path: "art/a.png", pixels: null },
      { path: "art/b.png", pixels: null },
    ];
    expect(slotPlacements(slot, outputs)).toEqual([
      { path: "art/a.png", x: 10, y: 20, w: 100, h: 50 },
      { path: "art/b.png", x: 142, y: 20, w: 100, h: 50 },
    ]);
  });

  it("keeps each output's own shape inside the slot, so a tall picture is not cropped", () => {
    const square = { board: "", x: 0, y: 0, w: 340, h: 340 };
    const outputs = [
      { path: "character.png", pixels: { width: 832, height: 1216 } },
      { path: "banner.png", pixels: { width: 2000, height: 500 } },
    ];
    expect(slotPlacements(square, outputs)).toEqual([
      { path: "character.png", x: 0, y: 0, w: 233, h: 340 },
      { path: "banner.png", x: 265, y: 0, w: 340, h: 85 },
    ]);
  });
});
