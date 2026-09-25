import { describe, expect, it } from "bun:test";
import { FOLDER_SIZE } from "../src/board-view";
import { drawnSheets, folderSheets, type SheetSlot, sheetStagger } from "../src/folder-sheets";

const { w, h } = FOLDER_SIZE;

describe("folderSheets", () => {
  it("gives every item a slot, however many are in there", () => {
    expect(folderSheets(1, w, h)).toHaveLength(1);
    expect(folderSheets(200, w, h)).toHaveLength(200);
  });

  it("fans the sheets so each shows an edge of its own", () => {
    const slots = folderSheets(4, w, h);
    const tops = slots.map((slot) => slot.y);
    const leans = slots.map((slot) => slot.lean);

    // Each sheet behind the one in front sits higher and leans further, and no
    // two share either, or the folder would draw as one thick sheet.
    expect(tops).toEqual([...tops].sort((one, two) => two - one));
    expect(leans).toEqual([...leans].sort((one, two) => one - two));
    expect(new Set(tops).size).toBe(slots.length);
  });

  it("keeps the fan the same width whatever the folder holds", () => {
    const spread = (count: number): number => {
      const tops = folderSheets(count, w, h).map((slot) => slot.y);
      return Math.max(...tops) - Math.min(...tops);
    };

    // A folder of forty is as open as a folder of four: sheets that kept
    // stepping would climb off the top of the card.
    expect(spread(40)).toBeCloseTo(spread(4), 5);
  });

  it("stacks what is past the fan on the back sheet", () => {
    const count = 200;
    const slots = folderSheets(count, w, h);
    const drawn = drawnSheets(count, h);
    expect(drawn).toBeLessThan(count);

    // Still a slot each, so every card still comes out of the folder — out of
    // the back of it, which is where a fat folder's back sheets are, and each in
    // its own turn.
    const drawnAt = (slot: SheetSlot): string =>
      JSON.stringify({ x: slot.x, y: slot.y, w: slot.w, h: slot.h, lean: slot.lean });
    expect(new Set(slots.slice(drawn - 1).map(drawnAt)).size).toBe(1);
    expect(slots.map((slot) => slot.index)).toEqual(slots.map((_, index) => index));
  });

  it("draws every sheet of a folder small enough for them to show", () => {
    expect(drawnSheets(0, h)).toBe(0);
    expect(drawnSheets(1, h)).toBe(1);
    expect(drawnSheets(4, h)).toBe(4);
  });

  it("puts the sheets behind the folder's front panel", () => {
    for (const slot of folderSheets(12, w, h)) {
      expect(slot.x).toBeGreaterThan(0);
      expect(slot.x + slot.w).toBeCloseTo(w, 5);
      expect(slot.y).toBeGreaterThan(0);
      expect(slot.y + slot.h).toBeLessThan(h);
    }
  });
});

describe("sheetStagger", () => {
  it("pulls one item out after another", () => {
    expect(sheetStagger(0, 4)).toBe(0);
    expect(sheetStagger(1, 4)).toBeGreaterThan(0);
    expect(sheetStagger(2, 4)).toBeCloseTo(sheetStagger(1, 4) * 2, 5);
  });

  it("empties a folder of any size in about the same time", () => {
    const last = (total: number): number => sheetStagger(total - 1, total);
    expect(last(200)).toBeLessThanOrEqual(last(6) * 2);
    expect(last(200)).toBeGreaterThan(0);
  });

  it("has one item come out at once", () => {
    expect(sheetStagger(0, 1)).toBe(0);
  });
});
