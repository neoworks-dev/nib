import { describe, expect, it } from "bun:test";
import { metaString, parseFrontmatter } from "../src/frontmatter";

describe("parseFrontmatter", () => {
  it("leaves a file with no block alone", () => {
    const source = "Just a note.\n";
    const { meta, body } = parseFrontmatter(source);
    expect(meta).toEqual({});
    expect(body).toBe(source);
  });

  it("does not read a block that is not the first line", () => {
    const source = "\n---\nid: x\n---\nBody\n";
    const { meta, body } = parseFrontmatter(source);
    expect(meta).toEqual({});
    expect(body).toBe(source);
  });

  it("does not treat an unterminated rule as a block", () => {
    const source = "---\nid: x\n\nBody\n";
    const { meta, body } = parseFrontmatter(source);
    expect(meta).toEqual({});
    expect(body).toBe(source);
  });

  it("reads scalars and strips the block from the body", () => {
    const { meta, body } = parseFrontmatter('---\nid: note-1\ntitle: "A note"\n---\nBody\n');
    expect(meta).toEqual({ id: "note-1", title: "A note" });
    expect(body).toBe("Body\n");
  });

  it("keeps a colon inside a value", () => {
    const { meta } = parseFrontmatter("---\ntitle: 10:30 standup\n---\n");
    expect(meta["title"]).toBe("10:30 standup");
  });

  it("reads an inline list", () => {
    const { meta } = parseFrontmatter("---\ntags: [a, b, 'c d']\n---\n");
    expect(meta["tags"]).toEqual(["a", "b", "c d"]);
  });

  it("reads a block list", () => {
    const { meta } = parseFrontmatter("---\ntags:\n  - a\n  - b\nid: note-1\n---\n");
    expect(meta["tags"]).toEqual(["a", "b"]);
    expect(meta["id"]).toBe("note-1");
  });

  it("reads an empty key as an empty string", () => {
    const { meta } = parseFrontmatter("---\nstate:\nid: note-1\n---\n");
    expect(meta["state"]).toBe("");
    expect(meta["id"]).toBe("note-1");
  });

  it("skips comments and unparseable lines rather than guessing", () => {
    const { meta } = parseFrontmatter("---\n# a comment\nnested:\n  deeper: 1\nid: note-1\n---\n");
    expect(meta["id"]).toBe("note-1");
    expect(meta["nested"]).toBe("");
  });
});

describe("metaString", () => {
  it("returns a scalar", () => {
    expect(metaString({ id: "note-1" }, "id")).toBe("note-1");
  });

  it("returns the first entry of a list", () => {
    expect(metaString({ id: ["note-1", "note-2"] }, "id")).toBe("note-1");
  });

  it("reads an empty value as absent", () => {
    expect(metaString({ id: "" }, "id")).toBeNull();
    expect(metaString({ id: [] }, "id")).toBeNull();
    expect(metaString({}, "id")).toBeNull();
  });
});
