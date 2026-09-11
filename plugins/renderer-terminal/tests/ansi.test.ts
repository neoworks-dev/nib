import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../src/ansi";

const escape = "";

describe("stripAnsi", () => {
  test("removes colour codes", () => {
    expect(stripAnsi(`${escape}[31mred${escape}[0m plain`)).toBe("red plain");
  });

  test("removes OSC title sequences", () => {
    expect(stripAnsi(`${escape}]0;titledone`)).toBe("done");
  });

  test("leaves plain output untouched", () => {
    expect(stripAnsi("total 0\ndrwxr-xr-x")).toBe("total 0\ndrwxr-xr-x");
  });
});
