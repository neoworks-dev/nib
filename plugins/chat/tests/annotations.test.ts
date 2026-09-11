import { describe, expect, test } from "bun:test";
import {
  composeAnnotatedMessage,
  createAnnotation,
  type StagedAnnotation,
} from "../src/annotations";

function annotation(text: string, note?: string): StagedAnnotation {
  return { id: "a", sessionId: "session-1", messageId: "message-1", text, ...(note && { note }) };
}

describe("createAnnotation", () => {
  test("carries the session, the anchor turn and the trimmed selection", () => {
    const staged = createAnnotation("session-1", "message-7", "  the failing assertion \n")!;
    expect(staged).toMatchObject({
      sessionId: "session-1",
      messageId: "message-7",
      text: "the failing assertion",
    });
    expect(staged.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  test("every annotation gets its own id", () => {
    const first = createAnnotation("session-1", "message-1", "one")!;
    const second = createAnnotation("session-1", "message-1", "one")!;
    expect(first.id).not.toBe(second.id);
  });

  test("a whitespace-only selection stages nothing", () => {
    expect(createAnnotation("session-1", "message-1", "  \n\t ")).toBeNull();
    expect(createAnnotation("session-1", "message-1", "")).toBeNull();
  });

  test("interior whitespace of a multi-line selection survives", () => {
    expect(createAnnotation("session-1", "message-1", "\nfirst\n  second\n")?.text).toBe(
      "first\n  second",
    );
  });

  test("a written comment is trimmed onto the annotation", () => {
    expect(
      createAnnotation("session-1", "message-1", "the loop", "  why retry here?  "),
    ).toMatchObject({
      text: "the loop",
      note: "why retry here?",
    });
  });

  test("a missing or blank comment leaves a plain quote", () => {
    expect(createAnnotation("session-1", "message-1", "the loop")).not.toHaveProperty("note");
    expect(createAnnotation("session-1", "message-1", "the loop", "  \n ")).not.toHaveProperty(
      "note",
    );
  });
});

describe("composeAnnotatedMessage", () => {
  test("quotes lead and the typed prompt follows after a blank line", () => {
    expect(composeAnnotatedMessage([annotation("the retry loop")], "why is this needed?")).toBe(
      "> the retry loop\n\nwhy is this needed?",
    );
  });

  test("a multi-line selection is quoted line by line", () => {
    expect(composeAnnotatedMessage([annotation("first line\nsecond line")], "explain")).toBe(
      "> first line\n> second line\n\nexplain",
    );
  });

  test("blank lines inside a selection stay in the quote without trailing space", () => {
    expect(composeAnnotatedMessage([annotation("head\n\ntail")], "why?")).toBe(
      "> head\n>\n> tail\n\nwhy?",
    );
  });

  test("several annotations become separate blockquotes", () => {
    expect(composeAnnotatedMessage([annotation("one"), annotation("two")], "compare these")).toBe(
      "> one\n\n> two\n\ncompare these",
    );
  });

  test("a note follows its quote across a blank line, ahead of the prompt", () => {
    expect(
      composeAnnotatedMessage(
        [annotation("the retry loop", "why is this needed?")],
        "and the timeout?",
      ),
    ).toBe("> the retry loop\n\nwhy is this needed?\n\nand the timeout?");
  });

  test("quotes with and without notes keep their pairing", () => {
    expect(
      composeAnnotatedMessage([annotation("one", "first note"), annotation("two")], "compare"),
    ).toBe("> one\n\nfirst note\n\n> two\n\ncompare");
  });

  test("an annotated quote alone is the whole message", () => {
    expect(composeAnnotatedMessage([annotation("this line", "explain it")], "")).toBe(
      "> this line\n\nexplain it",
    );
  });

  test("annotations alone produce a message with no trailing blank line", () => {
    expect(composeAnnotatedMessage([annotation("just this")], "   ")).toBe("> just this");
  });

  test("the draft is trimmed", () => {
    expect(composeAnnotatedMessage([annotation("quote")], "  ask  ")).toBe("> quote\n\nask");
  });

  test("without annotations the trimmed draft is the whole message", () => {
    expect(composeAnnotatedMessage([], "  plain prompt  ")).toBe("plain prompt");
    expect(composeAnnotatedMessage([], "   ")).toBe("");
  });
});
