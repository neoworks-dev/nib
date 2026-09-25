import { describe, expect, it } from "bun:test";
import { extractLinks, movedLinkTarget, rewriteLinks, stripCode } from "../src/links";

describe("extractLinks", () => {
  it("reads a bare name", () => {
    expect(extractLinks("see [[a-note]]")).toEqual([{ target: "a-note", alias: null }]);
  });

  it("reads an alias and a heading", () => {
    expect(extractLinks("[[a-note|the note]]")).toEqual([{ target: "a-note", alias: "the note" }]);
    expect(extractLinks("[[a-note#heading]]")).toEqual([{ target: "a-note", alias: null }]);
    expect(extractLinks("[[a-note#heading|alias]]")).toEqual([
      { target: "a-note", alias: "alias" },
    ]);
  });

  it("reads a path-qualified reference", () => {
    expect(extractLinks("[[topic-x/a-note]]")).toEqual([{ target: "topic-x/a-note", alias: null }]);
  });

  it("reads every link on a line", () => {
    expect(extractLinks("[[a]] then [[b]]")).toEqual([
      { target: "a", alias: null },
      { target: "b", alias: null },
    ]);
  });

  it("ignores an empty target", () => {
    expect(extractLinks("[[#heading]]")).toEqual([]);
    expect(extractLinks("[[]]")).toEqual([]);
  });

  it("ignores links inside a fenced block", () => {
    const body = "before [[a]]\n\n```md\n[[example]]\n```\n\nafter [[b]]\n";
    expect(extractLinks(body)).toEqual([
      { target: "a", alias: null },
      { target: "b", alias: null },
    ]);
  });

  it("ignores a link inside a tilde fence", () => {
    expect(extractLinks("~~~\n[[example]]\n~~~\n")).toEqual([]);
  });

  it("ignores a link inside an inline code span", () => {
    expect(extractLinks("write `[[a]]` to link, like [[b]]")).toEqual([
      { target: "b", alias: null },
    ]);
  });
});

describe("stripCode", () => {
  it("keeps line structure so bodies stay comparable", () => {
    const body = "one\n```\ntwo\n```\nthree\n";
    expect(stripCode(body).split("\n")).toHaveLength(body.split("\n").length);
  });

  it("blanks an inline span without joining its neighbours", () => {
    expect(stripCode("a `x` b")).toBe("a   b");
  });
});

describe("rewriteLinks", () => {
  const toTopicB = movedLinkTarget("topic-a/note.md", "topic-b/note.md");

  it("rewrites a path-qualified reference and leaves the bare name alone", () => {
    expect(rewriteLinks("[[topic-a/note]] and [[note]]", toTopicB)).toBe(
      "[[topic-b/note]] and [[note]]",
    );
  });

  it("keeps the alias and the heading", () => {
    expect(rewriteLinks("[[topic-a/note#why|the note]]", toTopicB)).toBe(
      "[[topic-b/note#why|the note]]",
    );
  });

  it("matches the reference with its extension written out", () => {
    expect(rewriteLinks("[[topic-a/note.md]]", toTopicB)).toBe("[[topic-b/note.md]]");
  });

  it("carries a topic's contents with it, and leaves the topic's own name alone", () => {
    const moved = movedLinkTarget("topic-a", "archive/topic-a");
    expect(rewriteLinks("[[topic-a]] [[topic-a/deep/note]]", moved)).toBe(
      "[[topic-a]] [[archive/topic-a/deep/note]]",
    );
  });

  it("leaves a bare name alone even when the moved item is the one it names", () => {
    const moved = movedLinkTarget("note.md", "topic-x/note.md");
    expect(rewriteLinks("[[note]]", moved)).toBe("[[note]]");
  });

  it("never touches code, which is where the guide spells the syntax out", () => {
    const body = "`[[topic-a/note]]`\n```\n[[topic-a/note]]\n```\n[[topic-a/note]]";
    expect(rewriteLinks(body, toTopicB)).toBe(
      "`[[topic-a/note]]`\n```\n[[topic-a/note]]\n```\n[[topic-b/note]]",
    );
  });

  it("returns the body unchanged when nothing points at the moved item", () => {
    const body = "[[other]] and [[topic-c/note]]\n";
    expect(rewriteLinks(body, toTopicB)).toBe(body);
  });
});
