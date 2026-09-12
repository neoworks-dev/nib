import { describe, expect, it } from "bun:test";
import type { VaultSnapshotItem } from "@nib-ui/vault";
import {
  bodyLineCount,
  cardKindFor,
  extensionOf,
  isMarkdownPath,
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

  it("gives anything that is not markdown a sheet, since a card can still name it", () => {
    expect(cardKindFor(item("a.ts", lines(1)))).toBe("sheet");
    expect(cardKindFor(item("notes.txt", lines(1)))).toBe("sheet");
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
