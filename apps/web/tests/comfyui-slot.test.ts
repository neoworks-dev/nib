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
    expect(slotPlacements(slot, ["art/a.png", "art/b.png"])).toEqual([
      { path: "art/a.png", x: 10, y: 20, w: 100, h: 50 },
      { path: "art/b.png", x: 142, y: 20, w: 100, h: 50 },
    ]);
  });
});
