import { describe, expect, test } from "bun:test";
import { diffLines } from "../src/diff";

describe("diffLines", () => {
  test("marks added, removed and context lines", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
      { kind: "context", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "context", text: "c" },
    ]);
  });

  test("handles insertion into an empty original (Write)", () => {
    expect(diffLines("", "one\ntwo")).toEqual([
      { kind: "added", text: "one" },
      { kind: "added", text: "two" },
    ]);
  });

  test("identical input produces only context lines", () => {
    expect(diffLines("x\ny", "x\ny").every((line) => line.kind === "context")).toBe(true);
  });
});
