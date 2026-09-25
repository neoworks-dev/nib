import { describe, expect, it } from "bun:test";
import type { VaultSnapshotItem } from "@nib-ui/vault";
import {
  bodyLineCount,
  cardKindFor,
  headingTitle,
  extensionOf,
  diagramSource,
  isMarkdownPath,
  mermaidBody,
  sessionIdOf,
  STICKY_MAX_LINES,
  urlBody,
} from "../src/card-kind";

function item(
  path: string,
  preview: string,
  overrides: Partial<VaultSnapshotItem> = {},
): VaultSnapshotItem {
  return {
    path,
    kind: "file",
    dir: "",
    name: path.replace(/\.[^.]+$/, ""),
    id: null,
    title: null,
    color: null,
    preview,
    truncated: false,
    links: [],
    ...overrides,
  } satisfies VaultSnapshotItem;
}

/** A body of exactly `lines` non-blank lines. */
function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
}

describe("cardKindFor", () => {
  it("calls a directory a folder whatever is in it", () => {
    expect(cardKindFor(item("notes", "", { kind: "topic" }))).toBe("folder");
  });

  it("splits markdown on the line count alone, with no frontmatter to say so", () => {
    expect(cardKindFor(item("a.md", lines(STICKY_MAX_LINES)))).toBe("sticky");
    expect(cardKindFor(item("a.md", lines(STICKY_MAX_LINES + 1)))).toBe("sheet");
  });

  it("ignores a `kind:` in the frontmatter: content is what decides", () => {
    const body = `---\nkind: sheet\n---\n${lines(2)}`;

    expect(cardKindFor(item("a.md", body))).toBe("sticky");
  });

  it("treats a clipped body as a sheet, because there is more of it than was sent", () => {
    expect(cardKindFor(item("a.md", lines(2), { truncated: true }))).toBe("sheet");
  });

  it("draws pictures and clips as visuals", () => {
    for (const path of ["a.png", "a.JPEG", "a.gif", "a.svg", "a.mp4", "a.webm"]) {
      expect(cardKindFor(item(path, ""))).toBe("visual");
    }
  });

  it("draws anything that is not markdown as a file rather than as a page", () => {
    expect(cardKindFor(item("a.ts", lines(1)))).toBe("file");
    expect(cardKindFor(item("notes.txt", lines(1)))).toBe("file");
  });

  it("draws a transcript as the chat it is, not as the file it is stored in", () => {
    // A `.jsonl` in a vault is a session log, and the plain file card said a
    // uuid and the word JSONL — the file name, and nothing about the chat.
    expect(cardKindFor(item("33c82344-5d75-4145-86de-e264d91555f3.jsonl", ""))).toBe("transcript");
  });

  it("is a webclip only when the whole body is one url", () => {
    expect(cardKindFor(item("a.md", "https://example.com/page"))).toBe("webclip");
    expect(cardKindFor(item("a.md", "https://example.com\nand a thought about it"))).toBe("sticky");
  });
});

describe("urlBody", () => {
  it("reads the url out of a body that is nothing else", () => {
    expect(urlBody("  https://example.com/a?b=c  ")).toBe("https://example.com/a?b=c");
    expect(urlBody("---\nid: x\n---\nhttps://example.com")).toBe("https://example.com");
  });

  it("refuses a body with anything beside the url", () => {
    expect(urlBody("see https://example.com")).toBeNull();
    expect(urlBody("https://example.com https://other.com")).toBeNull();
    expect(urlBody("")).toBeNull();
  });

  it("refuses a scheme that cannot be captured", () => {
    expect(urlBody("ftp://example.com")).toBeNull();
    expect(urlBody("mailto:someone@example.com")).toBeNull();
  });
});

describe("bodyLineCount", () => {
  it("does not count frontmatter", () => {
    expect(bodyLineCount("---\ntitle: x\nid: y\n---\none\ntwo")).toBe(2);
  });

  it("counts a run of blank lines once, so spacing is not length", () => {
    expect(bodyLineCount("one\n\n\n\ntwo")).toBe(3);
  });

  it("ignores blank lines at the ends", () => {
    expect(bodyLineCount("\n\none\n\n")).toBe(1);
  });
});

describe("extensionOf", () => {
  it("is lowercase, without the dot, and empty for a dotfile or a bare name", () => {
    expect(extensionOf("dir/Note.MD")).toBe("md");
    expect(extensionOf("dir/.gitignore")).toBe("");
    expect(extensionOf("dir/Makefile")).toBe("");
  });

  it("knows markdown by either spelling", () => {
    expect(isMarkdownPath("a.md")).toBe(true);
    expect(isMarkdownPath("a.markdown")).toBe(true);
    expect(isMarkdownPath("a.mdx")).toBe(false);
  });
});

/**
 * What a paste has to look like before the board turns it into a webclip. The
 * same test `urlBody` already answers for a file body, asked the other way round:
 * this is the gate the paste handler uses, so a pasted paragraph that happens to
 * mention a link stays a paste and never becomes a card.
 */
describe("what a paste has to be to become a webclip", () => {
  it("claims a bare url, with whitespace around it", () => {
    expect(urlBody("  https://example.com/a/b  ")).toBe("https://example.com/a/b");
  });

  it("leaves prose alone even when it holds a link", () => {
    expect(urlBody("look at https://example.com")).toBeNull();
    expect(urlBody("https://example.com is worth reading")).toBeNull();
  });

  it("leaves a list of urls alone: a webclip is one page", () => {
    expect(urlBody("https://a.example\nhttps://b.example")).toBeNull();
  });
});

describe("headingTitle", () => {
  it("takes the opening heading as the title and leaves the rest as the body", () => {
    expect(headingTitle("# The vault\n\nA project is a directory.")).toEqual({
      title: "The vault",
      body: "A project is a directory.",
      offset: 2,
    });
  });

  it("counts the lines it took off, so a tick lands on the file's own line", () => {
    expect(headingTitle("# Title\nstraight on").offset).toBe(1);
    expect(headingTitle("# Title\n\n\nafter two blanks").offset).toBe(3);
  });

  it("accepts the two deeper heading levels a note might open with", () => {
    expect(headingTitle("## Open questions\nthings").title).toBe("Open questions");
    expect(headingTitle("### Notes\nthings").title).toBe("Notes");
  });

  it("ignores a heading that is not the first thing in the body", () => {
    const body = "Some prose first.\n\n# Not the title";
    expect(headingTitle(body)).toEqual({ title: null, body, offset: 0 });
  });

  it("leaves a note that opens with prose alone", () => {
    expect(headingTitle("Just a thought")).toEqual({
      title: null,
      body: "Just a thought",
      offset: 0,
    });
  });

  it("is not fooled by a hash with no space after it", () => {
    expect(headingTitle("#hashtag\nmore").title).toBeNull();
  });
});

describe("sessionIdOf", () => {
  it("reads the session a transcript is of off its name", () => {
    expect(sessionIdOf("33c82344-5d75-4145-86de-e264d91555f3.jsonl")).toBe(
      "33c82344-5d75-4145-86de-e264d91555f3",
    );
    expect(sessionIdOf("topic/33c82344.jsonl")).toBe("33c82344");
  });
});

describe("mermaidBody", () => {
  it("reads a note whose whole body is one mermaid fence", () => {
    expect(mermaidBody("```mermaid\nflowchart TD\n  a --> b\n```")).toBe("flowchart TD\n  a --> b");
  });

  it("reads one under frontmatter, which is metadata rather than body", () => {
    expect(mermaidBody("---\nid: 7\n---\n```mermaid\ngraph TD\n```")).toBe("graph TD");
  });

  it("is nothing for a note that only contains a diagram among its prose", () => {
    expect(mermaidBody("Some notes.\n\n```mermaid\ngraph TD\n```\n\nMore notes.")).toBeNull();
  });

  it("is nothing for a fence of anything else", () => {
    expect(mermaidBody("```ts\nconst a = 1;\n```")).toBeNull();
  });

  it("is nothing for an empty fence", () => {
    expect(mermaidBody("```mermaid\n\n```")).toBeNull();
  });
});

describe("diagramSource", () => {
  it("is the whole file for a .mmd", () => {
    expect(diagramSource("flows/login.mmd", "flowchart TD\n  a --> b\n")).toBe(
      "flowchart TD\n  a --> b",
    );
  });

  it("is the fence alone for a note that is one", () => {
    expect(diagramSource("note.md", "```mermaid\ngraph TD\n```")).toBe("graph TD");
  });
});

describe("cardKindFor, diagrams", () => {
  it("draws a .mmd as a diagram", () => {
    expect(cardKindFor(item("flows/login.mmd", "flowchart TD\n  a --> b"))).toBe("diagram");
  });

  it("draws a note that is nothing but a fence as a diagram", () => {
    expect(cardKindFor(item("note.md", "```mermaid\ngraph TD\n  a --> b\n```"))).toBe("diagram");
  });

  it("leaves a note that merely contains a diagram as the note it is", () => {
    const body = "# Plan\n\n```mermaid\ngraph TD\n```\n\nThe rest of it.";
    expect(cardKindFor(item("note.md", body))).toBe("sticky");
  });

  it("draws a clipped note as a sheet rather than guessing at the rest", () => {
    const body = "```mermaid\ngraph TD";
    expect(cardKindFor(item("note.md", body, { truncated: true }))).toBe("sheet");
  });
});
