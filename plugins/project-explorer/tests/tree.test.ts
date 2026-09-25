import { describe, expect, test } from "bun:test";
import { statusMark, statusTone } from "../src/tree";

describe("git status colouring", () => {
  test("green for new files, amber for edits, red for deletions", () => {
    expect(statusTone("A")).toBe("text-green");
    expect(statusTone("?")).toBe("text-green");
    expect(statusTone("M")).toBe("text-amber");
    expect(statusTone("D")).toBe("text-red");
  });

  test("a changed subtree is muted and a clean entry reads as ordinary text", () => {
    expect(statusTone("child")).toBe("text-muted");
    expect(statusTone(null)).toBe("text-default");
  });

  test("marks untracked files with U and leaves subtrees unmarked", () => {
    expect(statusMark("?")).toBe("U");
    expect(statusMark("M")).toBe("M");
    expect(statusMark("child")).toBe("");
    expect(statusMark(null)).toBe("");
  });
});
