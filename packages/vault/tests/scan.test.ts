import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readVault, scanVault } from "../src/scan";

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scaffold(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nib-vault-"));
  created.push(root);

  for (const [path, body] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
  }
  return root;
}

function pathsOf(entries: readonly { path: string }[]): string[] {
  return entries.map((entry) => entry.path).sort((left, right) => left.localeCompare(right));
}

describe("readVault", () => {
  it("lists topics and files, and reads only the markdown", async () => {
    const root = scaffold({
      "root.md": "Body",
      "topic-x/a-note.md": "Body",
      "topic-x/diagram.png": "not markdown",
    });
    const { entries, bodies } = await readVault(root);

    expect(pathsOf(entries)).toEqual([
      "root.md",
      "topic-x",
      "topic-x/a-note.md",
      "topic-x/diagram.png",
    ]);
    expect(entries.find((entry) => entry.path === "topic-x")?.kind).toBe("topic");
    expect([...bodies.keys()].sort()).toEqual(["root.md", "topic-x/a-note.md"]);
  });

  it("reads a .markdown extension as well as .md", async () => {
    const root = scaffold({ "a.markdown": "Body" });
    const { bodies } = await readVault(root);
    expect([...bodies.keys()]).toEqual(["a.markdown"]);
  });

  it("walks into nested topics", async () => {
    const root = scaffold({ "a/b/c/deep.md": "Body" });
    const { entries } = await readVault(root);
    expect(pathsOf(entries)).toEqual(["a", "a/b", "a/b/c", "a/b/c/deep.md"]);
  });

  it("skips directories that are not content", async () => {
    const root = scaffold({ ".git/HEAD": "", "node_modules/pkg/index.js": "", "a.md": "Body" });
    const { entries } = await readVault(root);
    expect(pathsOf(entries)).toEqual(["a.md"]);
  });

  it("keeps an oversized file as an item without a body", async () => {
    const root = scaffold({ "big.md": "0123456789" });
    const { entries, bodies } = await readVault(root, { maxFileBytes: 4 });
    expect(pathsOf(entries)).toEqual(["big.md"]);
    expect(bodies.has("big.md")).toBe(false);
  });

  it("does not follow a symlinked directory", async () => {
    const root = scaffold({ "a.md": "Body" });
    symlinkSync(root, join(root, "loop"), "dir");

    const { entries } = await readVault(root);
    expect(pathsOf(entries)).toEqual(["a.md"]);
  });

  it("reads a vault that does not exist as empty", async () => {
    const { entries, bodies } = await readVault(join(tmpdir(), "nib-vault-absent"));
    expect(entries).toEqual([]);
    expect(bodies.size).toBe(0);
  });
});

describe("scanVault", () => {
  it("derives the index the same way whether or not the files are real", async () => {
    const root = scaffold({
      "intro.md": "The cottage, see [[a-note]] and [[nope]]",
      "topic-x/a-note.md": "---\nid: note-1\n---\nBody\n",
      "cottage.md": "",
    });
    const index = await scanVault(root);

    expect(index.links).toEqual([
      { from: "intro.md", target: "a-note", to: "topic-x/a-note.md", ambiguous: false },
      { from: "intro.md", target: "nope", to: null, ambiguous: false },
    ]);
    expect(index.unresolved).toEqual(["nope"]);
    expect(index.backlinks.get("topic-x/a-note.md")).toEqual(["intro.md"]);
    expect(index.byPath.get("topic-x/a-note.md")?.id).toBe("note-1");
  });
});
