import { describe, expect, test } from "bun:test";
import { deriveTaskTitle } from "../src/title";

describe("deriveTaskTitle", () => {
  test("uses the first non-empty line", () => {
    expect(deriveTaskTitle("\n\nAdd a retry to the uploader\n\nDetails follow")).toBe(
      "Add a retry to the uploader",
    );
  });

  test("drops the routing slash command", () => {
    expect(deriveTaskTitle("/review the auth middleware")).toBe("the auth middleware");
  });

  test("keeps only the file name of an @ reference", () => {
    expect(deriveTaskTitle("make a small edit to @apps/web/README.md")).toBe(
      "make a small edit to README.md",
    );
  });

  test("collapses runs of whitespace", () => {
    expect(deriveTaskTitle("fix   the\tbroken   test")).toBe("fix the broken test");
  });

  test("truncates on a word boundary", () => {
    const title = deriveTaskTitle(
      "Create an intelligent Gomoku game where the computer plays a heuristic opponent",
    );
    expect(title).toBe("Create an intelligent Gomoku game where the computer plays…");
  });

  test("truncates mid-word when there is no late word boundary", () => {
    expect(deriveTaskTitle(`${"a".repeat(80)} tail`)).toBe(`${"a".repeat(60)}…`);
  });

  test("is null when nothing survives cleaning", () => {
    expect(deriveTaskTitle("   \n  ")).toBeNull();
    expect(deriveTaskTitle("/clear")).toBeNull();
  });
});
