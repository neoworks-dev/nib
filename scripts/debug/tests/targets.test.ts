import { describe, expect, test } from "bun:test";
import { describeTarget, parseRegion, parseTarget } from "../targets.ts";

describe("parseTarget", () => {
  test("reads the ids probe prints", () => {
    expect(parseTarget("e12")).toEqual({ kind: "ref", ref: "e12" });
    expect(parseTarget("c3")).toEqual({ kind: "card", ref: "c3" });
    expect(parseTarget("pane-1-x0f2")).toEqual({ kind: "pane", instanceId: "pane-1-x0f2" });
    expect(parseTarget("pane=board")).toEqual({ kind: "pane", instanceId: "board" });
  });

  test("reads anything else as an accessible name", () => {
    expect(parseTarget("New note")).toEqual({ kind: "name", name: "New note" });
    expect(parseTarget("width = 40")).toEqual({ kind: "name", name: "width = 40" });
    expect(parseTarget("e12x")).toEqual({ kind: "name", name: "e12x" });
  });

  test("reads the prefixed forms", () => {
    expect(parseTarget("at=820,460")).toEqual({ kind: "point", x: 820, y: 460 });
    expect(parseTarget("role=button:Save")).toEqual({ kind: "name", name: "Save", role: "button" });
    expect(parseTarget("text=Skip")).toEqual({ kind: "text", text: "Skip" });
    expect(parseTarget("testid=composer")).toEqual({ kind: "testid", testId: "composer" });
    expect(parseTarget("css=.card")).toEqual({ kind: "css", selector: ".card" });
  });

  test("refuses a malformed prefixed form rather than guessing", () => {
    expect(() => parseTarget("")).toThrow("empty target");
    expect(() => parseTarget("at=820")).toThrow("at=<x>,<y>");
    expect(() => parseTarget("at=a,b")).toThrow("two numbers");
    expect(() => parseTarget("role=button")).toThrow("needs a name");
    expect(() => parseTarget("role=:Save")).toThrow("both parts");
    expect(() => parseTarget("css=")).toThrow("css target is empty");
  });

  test("describes a target the way an error should name it", () => {
    expect(describeTarget(parseTarget("c3"))).toBe("card c3");
    expect(describeTarget(parseTarget("role=button:Save"))).toBe('button "Save"');
    expect(describeTarget(parseTarget("at=1,2"))).toBe("point 1,2");
  });
});

describe("parseRegion", () => {
  test("reads x,y,width,height", () => {
    expect(parseRegion("10, 20, 300, 40")).toEqual({ x: 10, y: 20, width: 300, height: 40 });
  });

  test("refuses anything but four numbers with a positive size", () => {
    expect(() => parseRegion("10,20,300")).toThrow("four numbers");
    expect(() => parseRegion("10,20,0,40")).toThrow("positive width and height");
  });
});
