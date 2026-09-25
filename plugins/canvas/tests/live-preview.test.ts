import { describe, expect, it } from "bun:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { type Preview, previews } from "../src/live-preview";

/**
 * The preview is computed from an `EditorState`, which needs no DOM, so what is
 * under test is the reading of the tree: which syntax hides, on which lines,
 * and what it is drawn as instead.
 */
function state(doc: string, caret = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: caret },
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function hidden(doc: string, caret: number): string[] {
  return previews(state(doc, caret))
    .filter((preview): preview is Preview & { kind: "hide" } => preview.kind === "hide")
    .map((preview) => doc.slice(preview.from, preview.to));
}

function lineClasses(doc: string, caret = 0): string[] {
  return previews(state(doc, caret))
    .filter((preview): preview is Preview & { kind: "line" } => preview.kind === "line")
    .map((preview) => preview.className);
}

describe("headings", () => {
  it("style the line and hide the marks when the caret is elsewhere", () => {
    const doc = "# Title\n\ntext";
    expect(lineClasses(doc, doc.length)).toEqual(["cm-heading cm-heading-1"]);
    expect(hidden(doc, doc.length)).toEqual(["# "]);
  });

  it("show the marks on the line the caret is on", () => {
    expect(hidden("# Title\n\ntext", 3)).toEqual([]);
  });
});

describe("inline syntax", () => {
  it("hides emphasis, code and strikethrough marks off the active line", () => {
    const doc = "**bold** and *em* and `code` and ~~gone~~\nnext";
    expect(hidden(doc, doc.length)).toEqual(["**", "**", "*", "*", "`", "`", "~~", "~~"]);
  });

  it("keeps a link's label and hides its brackets and url", () => {
    const doc = "see [the note](http://x) now\nnext";
    expect(hidden(doc, doc.length)).toEqual(["[", "]", "(", "http://x", ")"]);
  });

  it("leaves an autolink alone, since its url is all it is", () => {
    expect(hidden("<http://x>\nnext", 12)).toEqual([]);
  });

  it("reveals everything on a line the selection touches", () => {
    const doc = "**bold**\n*em*";
    const wholeDoc = EditorState.create({
      doc,
      selection: { anchor: 0, head: doc.length },
      extensions: [markdown({ base: markdownLanguage })],
    });
    expect(previews(wholeDoc).filter((preview) => preview.kind === "hide")).toEqual([]);
  });
});

describe("lists", () => {
  it("draws a bullet for a dash off the active line", () => {
    const doc = "- one\n- two";
    const bullets = previews(state(doc, doc.length)).filter((preview) => preview.kind === "bullet");
    expect(bullets).toEqual([{ kind: "bullet", from: 0, to: 1 }]);
  });

  it("draws a task as a box, ticked or not, and hides the dash before it", () => {
    const doc = "- [ ] open\n- [x] done\n";
    const found = previews(state(doc, doc.length));
    expect(found.filter((preview) => preview.kind === "task")).toEqual([
      { kind: "task", from: 2, to: 5, checked: false },
      { kind: "task", from: 13, to: 16, checked: true },
    ]);
    expect(hidden(doc, doc.length)).toEqual(["- ", "- "]);
    expect(lineClasses(doc, doc.length)).toEqual(["cm-task", "cm-task cm-task-done"]);
  });

  it("keeps the box on the active line and shows the dash", () => {
    const doc = "- [ ] open";
    const found = previews(state(doc, 8));
    expect(found.filter((preview) => preview.kind === "task")).toHaveLength(1);
    expect(hidden(doc, 8)).toEqual([]);
  });
});

describe("blocks", () => {
  it("hides the fences of a code block the caret is outside of", () => {
    const doc = "```ts\nconst a = 1;\n```\nafter";
    expect(hidden(doc, doc.length)).toEqual(["```ts", "```"]);
    expect(lineClasses(doc, doc.length)).toEqual([
      "cm-code-block",
      "cm-code-block",
      "cm-code-block",
    ]);
  });

  it("shows the fences while the caret is inside the block", () => {
    expect(hidden("```ts\nconst a = 1;\n```\nafter", 8)).toEqual([]);
  });

  it("draws a rule for a horizontal rule off the active line", () => {
    const doc = "---\ntext";
    expect(previews(state(doc, doc.length)).filter((preview) => preview.kind === "rule")).toEqual([
      { kind: "rule", from: 0, to: 3 },
    ]);
  });

  it("styles a quote and hides its mark", () => {
    const doc = "> quoted\n\nafter";
    expect(lineClasses(doc, doc.length)).toEqual(["cm-quote"]);
    expect(hidden(doc, doc.length)).toEqual([">"]);
  });
});

describe("mermaid fences", () => {
  const doc = "text\n\n```mermaid\nflowchart TD\n  a --> b\n```\n\nafter";

  it("draw the fence as a diagram when the caret is elsewhere", () => {
    const diagram = previews(state(doc, 0)).find((preview) => preview.kind === "diagram");
    expect(diagram?.source).toBe("flowchart TD\n  a --> b");
  });

  it("show the source again on the lines the caret is on", () => {
    const inside = doc.indexOf("flowchart");
    expect(previews(state(doc, inside)).some((preview) => preview.kind === "diagram")).toBe(false);
    expect(lineClasses(doc, inside)).toContain("cm-code-block");
  });

  it("leave a fence that is still open as code", () => {
    const open = "```mermaid\nflowchart TD";
    expect(previews(state(open, 0)).some((preview) => preview.kind === "diagram")).toBe(false);
  });

  it("leave a fence of anything else as code", () => {
    const code = "```ts\nconst a = 1;\n```";
    expect(previews(state(code, 0)).some((preview) => preview.kind === "diagram")).toBe(false);
  });
});

describe("tables", () => {
  const grid = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  const doc = `intro\n\n${grid}`;

  it("are drawn as a grid, whole lines at a time", () => {
    const table = previews(state(doc, 0)).find((preview) => preview.kind === "table");
    expect(table).toMatchObject({ from: doc.indexOf(grid), to: doc.length, source: grid });
  });

  it("stay the pipes while one is being typed, so the caret is not moved", () => {
    const inside = doc.indexOf("1");
    expect(previews(state(doc, inside)).some((preview) => preview.kind === "table")).toBe(false);
    expect(lineClasses(doc, inside)).toContain("cm-table");
  });
});

describe("math", () => {
  it("draws an inline formula where the caret is elsewhere", () => {
    const doc = "first line\nmass is $E = mc^2$ here";
    const math = previews(state(doc, 0)).find((preview) => preview.kind === "math");
    expect(math).toMatchObject({ source: "E = mc^2", display: false, block: false });
  });

  it("draws a display formula on its own lines as a block", () => {
    const doc = "before\n\n$$E = mc^2$$\n\nafter";
    const math = previews(state(doc, 0)).find((preview) => preview.kind === "math");
    expect(math).toMatchObject({ source: "E = mc^2", display: true, block: true });
  });

  it("shows the source again on the line the caret is on", () => {
    const doc = "first line\nmass is $E = mc^2$ here";
    const inside = doc.indexOf("mc");
    expect(previews(state(doc, inside)).some((preview) => preview.kind === "math")).toBe(false);
  });

  it("leaves a dollar sign in code alone", () => {
    const doc = "first line\n\nthe `$PATH` and `$HOME` of it";
    expect(previews(state(doc, 0)).some((preview) => preview.kind === "math")).toBe(false);
  });

  it("leaves two prices alone", () => {
    const doc = "first line\n\nit went from $5 to $10 overnight";
    expect(previews(state(doc, 0)).some((preview) => preview.kind === "math")).toBe(false);
  });
});
