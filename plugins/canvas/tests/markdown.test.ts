import { describe, expect, it } from "bun:test";
import {
  documentToMarkdown,
  parseBlock,
  parseBlocks,
  parseDocument,
  parseInline,
  splitFrontmatter,
  toMarkdown,
  toggleTask,
} from "../src/markdown";

describe("parseBlock", () => {
  it("reads each style off its own prefix", () => {
    expect(parseBlock("# Title")).toEqual({ style: "display", text: "Title", done: false });
    expect(parseBlock("## Title")).toEqual({ style: "headline", text: "Title", done: false });
    expect(parseBlock("### Title")).toEqual({ style: "subheader", text: "Title", done: false });
    expect(parseBlock("- one")).toEqual({ style: "list", text: "one", done: false });
    expect(parseBlock("* one")).toEqual({ style: "list", text: "one", done: false });
    expect(parseBlock("plain")).toEqual({ style: "body", text: "plain", done: false });
  });

  it("reads a task, checked either way round", () => {
    expect(parseBlock("- [ ] do it")).toEqual({ style: "task", text: "do it", done: false });
    expect(parseBlock("- [x] did it")).toEqual({ style: "task", text: "did it", done: true });
    expect(parseBlock("- [X] did it")).toEqual({ style: "task", text: "did it", done: true });
  });

  it("prefers the task prefix over the list prefix it starts with", () => {
    expect(parseBlock("- [ ] do it").style).toBe("task");
  });
});

describe("round trip", () => {
  const source = [
    "# Today",
    "",
    "Some prose about it.",
    "- a list line",
    "1. the first step",
    "7. the seventh",
    "- [ ] a task",
    "- [x] a done task",
    "### A subheader",
  ].join("\n");

  it("comes back exactly as it went in", () => {
    expect(toMarkdown(parseBlocks(source))).toBe(source);
  });

  it("normalises line endings on the way in", () => {
    expect(toMarkdown(parseBlocks("a\r\nb\rc"))).toBe("a\nb\nc");
  });
});

describe("ordered lists", () => {
  it("keeps the number it was written with, so the list is not renumbered", () => {
    expect(parseBlock("3. third")).toEqual({
      style: "ordered",
      text: "third",
      done: false,
      ordinal: 3,
    });
  });

  it("leaves a line that only looks like one alone", () => {
    expect(parseBlock("1.no space").style).toBe("body");
    expect(parseBlock("1) a paren").style).toBe("body");
  });
});

describe("parseInline", () => {
  it("marks the emphasis and takes its syntax off", () => {
    expect(parseInline("a **bold** b")).toEqual([
      { text: "a " },
      { text: "bold", strong: true },
      { text: " b" },
    ]);
    expect(parseInline("~~gone~~")).toEqual([{ text: "gone", strike: true }]);
    expect(parseInline("*soft* and _soft_")).toEqual([
      { text: "soft", em: true },
      { text: " and " },
      { text: "soft", em: true },
    ]);
  });

  it("carries the outer mark through the inner one", () => {
    expect(parseInline("**all ~~but~~ this**")).toEqual([
      { text: "all ", strong: true },
      { text: "but", strike: true, strong: true },
      { text: " this", strong: true },
    ]);
  });

  it("leaves an unbalanced marker as the text it is", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ text: "2 * 3 = 6" }]);
    expect(parseInline("**open")).toEqual([{ text: "**open" }]);
  });

  it("says nothing about a line with no emphasis in it", () => {
    expect(parseInline("plain")).toEqual([{ text: "plain" }]);
  });
});

describe("toggleTask", () => {
  it("flips a task and leaves every other style alone", () => {
    const task = { style: "task" as const, text: "do it", done: false };
    expect(toggleTask(task)).toEqual({ ...task, done: true });
    expect(toggleTask(toggleTask(task))).toEqual(task);
    const body = { style: "body" as const, text: "prose", done: false };
    expect(toggleTask(body)).toBe(body);
  });
});

describe("parseDocument", () => {
  it("keeps frontmatter out of the blocks and writes it back untouched", () => {
    const source = "---\nid: abc\ntitle: Note\n---\n# Today\n- [ ] a task";
    const document = parseDocument(source);

    expect(document.frontmatter).toBe("---\nid: abc\ntitle: Note\n---");
    expect(document.blocks.map((block) => block.style)).toEqual(["display", "task"]);
    expect(documentToMarkdown(document)).toBe(source);
  });

  it("treats a lone opening fence as body rather than losing the file to it", () => {
    const document = parseDocument("---\nnot really frontmatter");

    expect(document.frontmatter).toBeNull();
    expect(document.blocks).toHaveLength(2);
  });

  it("round trips a file with no frontmatter", () => {
    expect(documentToMarkdown(parseDocument("just a line"))).toBe("just a line");
  });
});

describe("splitFrontmatter", () => {
  it("returns the body as the text it is, frontmatter aside", () => {
    expect(splitFrontmatter("---\nid: abc\n---\n# Today\n\ntext\n")).toEqual({
      frontmatter: "---\nid: abc\n---",
      body: "# Today\n\ntext\n",
    });
  });

  it("leaves a document without frontmatter whole", () => {
    expect(splitFrontmatter("just a line")).toEqual({ frontmatter: null, body: "just a line" });
  });

  it("gives frontmatter with nothing after it an empty body", () => {
    expect(splitFrontmatter("---\nid: abc\n---")).toEqual({
      frontmatter: "---\nid: abc\n---",
      body: "",
    });
  });
});
