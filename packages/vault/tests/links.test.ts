import { describe, expect, it } from "bun:test";
import { extractLinks, stripCode } from "../src/links";

describe("extractLinks", () => {
  it("reads a bare name", () => {
    expect(extractLinks("see [[a-note]]")).toEqual([{ target: "a-note", alias: null }]);
  });

  it("reads an alias and a heading", () => {
    expect(extractLinks("[[a-note|the note]]")).toEqual([{ target: "a-note", alias: "the note" }]);
    expect(extractLinks("[[a-note#heading]]")).toEqual([{ target: "a-note", alias: null }]);
    expect(extractLinks("[[a-note#heading|alias]]")).toEqual([
      { target: "a-note", alias: "alias" },
    ]);
  });

  it("reads a path-qualified reference", () => {
    expect(extractLinks("[[topic-x/a-note]]")).toEqual([{ target: "topic-x/a-note", alias: null }]);
  });

  it("reads every link on a line", () => {
    expect(extractLinks("[[a]] then [[b]]")).toEqual([
      { target: "a", alias: null },
      { target: "b", alias: null },
    ]);
  });

  it("ignores an empty target", () => {
    expect(extractLinks("[[#heading]]")).toEqual([]);
    expect(extractLinks("[[]]")).toEqual([]);
  });

  it("ignores links inside a fenced block", () => {
    const body = "before [[a]]\n\n```md\n[[example]]\n```\n\nafter [[b]]\n";
    expect(extractLinks(body)).toEqual([
      { target: "a", alias: null },
      { target: "b", alias: null },
    ]);
  });

  it("ignores a link inside a tilde fence", () => {
    expect(extractLinks("~~~\n[[example]]\n~~~\n")).toEqual([]);
  });

  it("ignores a link inside an inline code span", () => {
    expect(extractLinks("write `[[a]]` to link, like [[b]]")).toEqual([
      { target: "b", alias: null },
    ]);
  });
});

describe("stripCode", () => {
  it("keeps line structure so bodies stay comparable", () => {
    const body = "one\n```\ntwo\n```\nthree\n";
    expect(stripCode(body).split("\n")).toHaveLength(body.split("\n").length);
  });

  it("blanks an inline span without joining its neighbours", () => {
    expect(stripCode("a `x` b")).toBe("a   b");
  });
});
