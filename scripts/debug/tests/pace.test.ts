import { describe, expect, test } from "bun:test";
import { emptyPace, noteAction, notePicture, refusePicture } from "../pace.ts";

describe("refusePicture", () => {
  test("allows the first picture of a run", () => {
    expect(refusePicture(emptyPace(), "full")).toBeNull();
  });

  test("refuses the same framing twice without an action between", () => {
    const pace = notePicture(emptyPace(), "full", "001-board.png");
    expect(refusePicture(pace, "full")).toContain("nothing has happened since 001-board.png");
  });

  test("allows one closer look at the same screen, then refuses", () => {
    const first = notePicture(emptyPace(), "full", "001.png");
    expect(refusePicture(first, "crop:0,0,10,10")).toBeNull();
    const second = notePicture(first, "crop:0,0,10,10", "002.png");
    expect(refusePicture(second, "of:c3")).toContain("2 pictures of this screen already");
  });

  test("an action gives the allowance back", () => {
    const shot = notePicture(emptyPace(), "full", "001.png");
    expect(refusePicture(noteAction(shot), "full")).toBeNull();
  });
});
