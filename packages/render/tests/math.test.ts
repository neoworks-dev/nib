import { describe, expect, it } from "bun:test";
import { mathSpans, renderMath } from "../src/math";

describe("mathSpans", () => {
  it("finds an inline formula and where it sits", () => {
    const text = "mass is $E = mc^2$ here";
    expect(mathSpans(text)).toEqual([{ from: 8, to: 18, source: "E = mc^2", display: false }]);
  });

  it("finds a display formula", () => {
    expect(mathSpans("$$E = mc^2$$")).toEqual([
      { from: 0, to: 12, source: "E = mc^2", display: true },
    ]);
  });

  it("reads the display delimiters before the inline ones", () => {
    expect(mathSpans("$$a$$").map((span) => span.display)).toEqual([true]);
  });

  it("is nothing for two prices", () => {
    expect(mathSpans("it went from $5 to $10 overnight")).toEqual([]);
  });

  it("is nothing for a dollar sign the author escaped", () => {
    expect(mathSpans("costs \\$5 and $10 more")).toEqual([]);
  });

  it("does not run an inline formula across a line break", () => {
    expect(mathSpans("open $here\nand $there")).toEqual([]);
  });

  it("finds each of several formulas", () => {
    expect(mathSpans("$a$ and $b$").map((span) => span.source)).toEqual(["a", "b"]);
  });
});

describe("renderMath", () => {
  it("sets a formula as markup", () => {
    expect(renderMath("E = mc^2", false)).toContain("katex");
  });

  it("centres a display formula", () => {
    expect(renderMath("E = mc^2", true)).toContain("katex-display");
  });

  it("shows a formula it cannot parse as itself rather than throwing", () => {
    expect(renderMath("\\frac{", false)).toContain("katex");
  });
});
