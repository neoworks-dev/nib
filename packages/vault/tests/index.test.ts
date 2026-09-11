import { describe, expect, it } from "bun:test";
import {
  buildVaultIndex,
  entryName,
  resolveLink,
  unlinkedMentions,
  type VaultEntry,
  type VaultSource,
} from "../src/tree";

/** A listing the way the scan produces one: every directory is a topic. */
function vault(files: Record<string, string>): VaultSource {
  const bodies = new Map(Object.entries(files));
  const topics = new Set<string>();

  for (const path of bodies.keys()) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      topics.add(parts.slice(0, depth).join("/"));
    }
  }

  const entries: VaultEntry[] = [
    ...[...topics].map((path) => ({ path, kind: "topic" as const })),
    ...[...bodies.keys()].map((path) => ({ path, kind: "file" as const })),
  ];
  return { entries, bodies };
}

describe("entryName", () => {
  it("is the stem of a file", () => {
    expect(entryName({ path: "a-note.md", kind: "file" })).toBe("a-note");
    expect(entryName({ path: "topic-x/diagram.png", kind: "file" })).toBe("diagram");
  });

  it("keeps only the last extension", () => {
    expect(entryName({ path: "archive.tar.gz", kind: "file" })).toBe("archive.tar");
  });

  it("keeps a leading dot, which is a name and not an extension", () => {
    expect(entryName({ path: ".env", kind: "file" })).toBe(".env");
  });

  it("is the basename of a topic", () => {
    expect(entryName({ path: "topic-x", kind: "topic" })).toBe("topic-x");
    expect(entryName({ path: "topic-x/sub-topic", kind: "topic" })).toBe("sub-topic");
  });
});

describe("buildVaultIndex", () => {
  it("treats a directory and a file the same way", () => {
    const index = buildVaultIndex(vault({ "topic-x/a-note.md": "" }));
    expect(index.items.map((item) => item.kind)).toEqual(["topic", "file"]);
    expect(index.byPath.get("topic-x")).toBeDefined();
  });

  it("reads id and title out of frontmatter", () => {
    const index = buildVaultIndex(
      vault({ "a-note.md": '---\nid: note-1\ntitle: "The Cottage"\n---\n' }),
    );
    const item = index.byPath.get("a-note.md");
    expect(item?.id).toBe("note-1");
    expect(item?.title).toBe("The Cottage");
  });

  it("leaves id and title null when nothing declares them", () => {
    const index = buildVaultIndex(vault({ "a-note.md": "Body\n" }));
    expect(index.byPath.get("a-note.md")?.id).toBeNull();
    expect(index.byPath.get("a-note.md")?.title).toBeNull();
  });

  it("strips the frontmatter from the text mentions are scanned in", () => {
    const index = buildVaultIndex(vault({ "a-note.md": "---\ntitle: X\n---\nBody\n" }));
    expect(index.byPath.get("a-note.md")?.text).toBe("Body\n");
  });

  it("orders items by path so a scan is stable", () => {
    const index = buildVaultIndex(vault({ "b.md": "", "a/c.md": "", "a.md": "" }));
    expect(index.items.map((item) => item.path)).toEqual(["a", "a.md", "a/c.md", "b.md"]);
  });
});

describe("resolveLink", () => {
  const index = buildVaultIndex(
    vault({
      "intro.md": "[[a-note]] [[b]] [[nope]]",
      "one/a-note.md": "",
      "two/a-note.md": "",
      "b.md": "",
    }),
  );

  it("resolves a bare name", () => {
    const from = index.byPath.get("b.md") ?? null;
    const resolved = resolveLink("b", from, index);
    expect(resolved.item?.path).toBe("b.md");
    expect(resolved.ambiguous).toBe(false);
  });

  it("resolves a path-qualified reference", () => {
    const from = index.byPath.get("b.md") ?? null;
    const resolved = resolveLink("two/a-note", from, index);
    expect(resolved.item?.path).toBe("two/a-note.md");
  });

  it("resolves a topic by its directory name", () => {
    const from = index.byPath.get("b.md") ?? null;
    const resolved = resolveLink("one", from, index);
    expect(resolved.item?.path).toBe("one");
    expect(resolved.item?.kind).toBe("topic");
  });

  it("prefers the source's own directory when a name is not unique", () => {
    const from = index.byPath.get("one/a-note.md") ?? null;
    const resolved = resolveLink("a-note", from, index);
    expect(resolved.item?.path).toBe("one/a-note.md");
    expect(resolved.ambiguous).toBe(true);
  });

  it("falls back to the shortest path, then path order", () => {
    const from = index.byPath.get("b.md") ?? null;
    const resolved = resolveLink("a-note", from, index);
    expect(resolved.item?.path).toBe("one/a-note.md");
    expect(resolved.ambiguous).toBe(true);
  });

  it("reports a name nothing answers to", () => {
    expect(resolveLink("nope", null, index)).toEqual({ item: null, ambiguous: false });
    expect(resolveLink("", null, index)).toEqual({ item: null, ambiguous: false });
  });
});

describe("links and backlinks", () => {
  it("records where each link landed, and what did not land", () => {
    const index = buildVaultIndex(vault({ "intro.md": "[[b]] [[nope]]", "b.md": "" }));
    expect(index.links).toEqual([
      { from: "intro.md", target: "b", to: "b.md", ambiguous: false },
      { from: "intro.md", target: "nope", to: null, ambiguous: false },
    ]);
    expect(index.unresolved).toEqual(["nope"]);
  });

  it("counts a source once however often it links the same target", () => {
    const index = buildVaultIndex(vault({ "intro.md": "[[b]] and [[b|again]]", "b.md": "" }));
    expect(index.backlinks.get("b.md")).toEqual(["intro.md"]);
  });

  it("keeps backlink sources in path order", () => {
    const index = buildVaultIndex(vault({ "z.md": "[[b]]", "a.md": "[[b]]", "b.md": "" }));
    expect(index.backlinks.get("b.md")).toEqual(["a.md", "z.md"]);
  });

  it("expects no backlinks for an item nothing points at", () => {
    const index = buildVaultIndex(vault({ "b.md": "" }));
    expect(index.backlinks.get("b.md")).toBeUndefined();
  });
});

describe("unlinkedMentions", () => {
  it("finds a name named in a body without a link", () => {
    const index = buildVaultIndex(vault({ "intro.md": "the cottage is nice", "cottage.md": "" }));
    expect(unlinkedMentions(index)).toEqual([
      { source: "intro.md", target: "cottage.md", count: 1 },
    ]);
  });

  it("counts every occurrence", () => {
    const index = buildVaultIndex(vault({ "intro.md": "cottage. cottage!", "cottage.md": "" }));
    expect(unlinkedMentions(index)).toEqual([
      { source: "intro.md", target: "cottage.md", count: 2 },
    ]);
  });

  it("ignores a mention that is already a link", () => {
    const index = buildVaultIndex(
      vault({ "intro.md": "[[cottage]] the cottage", "cottage.md": "" }),
    );
    expect(unlinkedMentions(index)).toEqual([]);
  });

  it("does not match an item against itself", () => {
    const index = buildVaultIndex(vault({ "cottage.md": "the cottage" }));
    expect(unlinkedMentions(index)).toEqual([]);
  });

  it("matches regardless of case, and only on a word boundary", () => {
    const index = buildVaultIndex(vault({ "intro.md": "The Cottage, cottages", "cottage.md": "" }));
    expect(unlinkedMentions(index)).toEqual([
      { source: "intro.md", target: "cottage.md", count: 1 },
    ]);
  });

  it("prefers a title over the file name", () => {
    const index = buildVaultIndex(
      vault({ "intro.md": "The Cottage", "note-1.md": "---\ntitle: The Cottage\n---\n" }),
    );
    expect(unlinkedMentions(index)).toEqual([
      { source: "intro.md", target: "note-1.md", count: 1 },
    ]);
  });

  it("skips names too short to be a mention", () => {
    const index = buildVaultIndex(vault({ "intro.md": "a b c", "a.md": "" }));
    expect(unlinkedMentions(index)).toEqual([]);
  });

  it("does not scan fenced or inline code", () => {
    const index = buildVaultIndex(
      vault({ "intro.md": "```\nthe cottage\n```\nand `the cottage`\n", "cottage.md": "" }),
    );
    expect(unlinkedMentions(index)).toEqual([]);
  });
});
