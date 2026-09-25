import { describe, expect, it } from "bun:test";
import { sheetPaneLabel } from "../src/sheet-pane";

describe("sheetPaneLabel", () => {
  it("names the pane after the note, without its folder or extension", () => {
    expect(sheetPaneLabel({ path: "topic/what a card draws.md" })).toBe("what a card draws");
    expect(sheetPaneLabel({ path: "note.MD" })).toBe("note");
  });

  it("falls back to the pane's name when nothing is open", () => {
    expect(sheetPaneLabel(undefined)).toBe("Note");
    expect(sheetPaneLabel({ path: "" })).toBe("Note");
  });
});
