import { describe, expect, test } from "bun:test";
import { highlightLines, languageFor, splitMarkup } from "../src/highlight";

describe("languageFor", () => {
  test("maps known extensions and gives up on unknown ones", () => {
    expect(languageFor("src/app.ts")).toBe("typescript");
    expect(languageFor("Component.svelte")).toBe("xml");
    expect(languageFor("notes.unknown")).toBeNull();
    expect(languageFor("LICENSE")).toBeNull();
  });
});

describe("splitMarkup", () => {
  test("closes and reopens a span that covers several lines", () => {
    const lines = splitMarkup('<span class="hljs-comment">/* one\ntwo */</span>');

    expect(lines).toEqual([
      '<span class="hljs-comment">/* one</span>',
      '<span class="hljs-comment">two */</span>',
    ]);
  });

  test("leaves single-line markup untouched", () => {
    expect(splitMarkup('<span class="hljs-keyword">const</span> x')).toEqual([
      '<span class="hljs-keyword">const</span> x',
    ]);
  });
});

describe("highlightLines", () => {
  test("marks up known languages and escapes unknown ones", () => {
    const [first] = highlightLines("const answer = 42;", "a.ts");
    expect(first).toContain("hljs-keyword");

    expect(highlightLines("<not code>", "notes.unknown")).toEqual(["&lt;not code&gt;"]);
  });

  test("returns one entry per source line", () => {
    expect(highlightLines("a\nb\nc", "x.txt")).toHaveLength(3);
  });
});
