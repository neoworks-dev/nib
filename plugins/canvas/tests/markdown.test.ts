import { describe, expect, it } from "bun:test";
import {
  type Block,
  blockAfter,
  blockStyleRows,
  documentToMarkdown,
  parseBlock,
  parseBlocks,
  parseDocument,
  restyle,
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

describe("restyle", () => {
  const task: Block = { style: "task", text: "do it", done: true };

  it("keeps the words: a style is how a line is drawn, not what it says", () => {
    expect(restyle(task, "headline")).toEqual({
      style: "headline",
      text: "do it",
      done: false,
    });
  });

  it("keeps a task's checked state when the style does not change", () => {
    expect(restyle(task, "task")).toBe(task);
  });

  it("forgets `done` on anything that is not a task, so it cannot come back", () => {
    const body = restyle(task, "body");

    expect(body.done).toBe(false);
    expect(restyle(body, "task").done).toBe(false);
  });
});

describe("toggleTask", () => {
  it("flips a task and leaves everything else alone", () => {
    expect(toggleTask({ style: "task", text: "x", done: false }).done).toBe(true);
    expect(toggleTask({ style: "task", text: "x", done: true }).done).toBe(false);

    const body: Block = { style: "body", text: "x", done: false };
    expect(toggleTask(body)).toBe(body);
  });
});

describe("blockAfter", () => {
  it("continues a list or a task, so writing three is three lines", () => {
    expect(blockAfter({ style: "list", text: "a", done: false }).style).toBe("list");
    expect(blockAfter({ style: "task", text: "a", done: true })).toEqual({
      style: "task",
      text: "",
      done: false,
    });
  });

  it("drops back to body after a heading", () => {
    expect(blockAfter({ style: "display", text: "Today", done: false }).style).toBe("body");
    expect(blockAfter({ style: "subheader", text: "Today", done: false }).style).toBe("body");
  });
});

describe("blockStyleRows", () => {
  it("lists exactly the six rows, in Spatial's order", () => {
    expect(blockStyleRows("body").map((row) => row.label)).toEqual([
      "01 Display",
      "02 Headline",
      "03 Subheader",
      "04 Body",
      "List",
      "Task",
    ]);
  });

  it("greys exactly one row: the style the block already has", () => {
    for (const current of ["display", "headline", "subheader", "body", "list", "task"] as const) {
      const rows = blockStyleRows(current);
      const disabled = rows.filter((row) => row.disabled);

      expect(disabled).toHaveLength(1);
      expect(disabled[0]?.style).toBe(current);
    }
  });

  it("still offers every style, so none becomes one you cannot get back to", () => {
    expect(blockStyleRows("task")).toHaveLength(6);
  });

  it("draws its one divider above List, splitting the styles from the lists", () => {
    const rows = blockStyleRows("body");

    expect(rows.filter((row) => row.dividerBefore).map((row) => row.style)).toEqual(["list"]);
  });
});
