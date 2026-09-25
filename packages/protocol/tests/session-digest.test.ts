import { describe, expect, test } from "bun:test";
import {
  type BlockView,
  createSessionView,
  type MessageView,
  sessionDigest,
  type SessionView,
} from "@nib-ui/protocol";

function block(partial: Partial<BlockView> & { id: string }): BlockView {
  return {
    messageId: "m",
    kind: "text",
    toolName: null,
    toolUseId: null,
    text: "",
    inputJson: "",
    content: null,
    completed: true,
    ...partial,
  };
}

function message(role: MessageView["role"], blocks: BlockView[]): MessageView {
  return { id: blocks[0]?.id ?? role, role, blocks, completed: true, stopReason: null };
}

function view(messages: MessageView[]): SessionView {
  return { ...createSessionView("s1"), messages };
}

describe("sessionDigest", () => {
  test("takes the opening prompt and the newest reply", () => {
    const digest = sessionDigest(
      view([
        message("user", [block({ id: "u1", text: "Fix the stack gesture" })]),
        message("assistant", [block({ id: "a1", text: "Looking at it" })]),
        message("user", [block({ id: "u2", text: "and the card too" })]),
        message("assistant", [block({ id: "a2", text: "Done" })]),
      ]),
    );

    expect(digest).toEqual({
      prompt: "Fix the stack gesture",
      reply: "Done",
      // The opening prompt is the chat's name, so the tail starts after it.
      recent: [
        { role: "assistant", text: "Looking at it" },
        { role: "user", text: "and the card too" },
        { role: "assistant", text: "Done" },
      ],
    });
  });

  test("keeps only the end of a long chat, oldest of those first", () => {
    const messages: MessageView[] = [];
    for (let turn = 0; turn < 12; turn += 1) {
      messages.push(message("user", [block({ id: `u${turn}`, text: `ask ${turn}` })]));
      messages.push(message("assistant", [block({ id: `a${turn}`, text: `say ${turn}` })]));
    }

    const recent = sessionDigest(view(messages)).recent;

    expect(recent).toHaveLength(8);
    expect(recent[0]).toEqual({ role: "user", text: "ask 8" });
    expect(recent.at(-1)).toEqual({ role: "assistant", text: "say 11" });
  });

  test("clips a long message rather than carrying the whole of it", () => {
    const digest = sessionDigest(
      view([
        message("user", [block({ id: "u1", text: "open" })]),
        message("assistant", [block({ id: "a1", text: "x".repeat(600) })]),
      ]),
    );

    expect(digest.recent[0]?.text).toHaveLength(321);
    expect(digest.recent[0]?.text.endsWith("…")).toBe(true);
  });

  test("reads a completed block's content rather than its accumulated deltas", () => {
    const digest = sessionDigest(
      view([
        message("user", [
          block({ id: "u1", text: "partial", content: { kind: "text", text: "the whole prompt" } }),
        ]),
      ]),
    );

    expect(digest.prompt).toBe("the whole prompt");
  });

  test("skips a user message that is only tool results: it is not a prompt", () => {
    const digest = sessionDigest(
      view([
        message("user", [
          block({ id: "r1", kind: "tool_result", toolUseId: "t1", text: "42 files" }),
        ]),
        message("user", [block({ id: "u1", text: "what did that say?" })]),
      ]),
    );

    expect(digest.prompt).toBe("what did that say?");
  });

  test("has nothing to say about a chat with no turns in it", () => {
    expect(sessionDigest(createSessionView("s1"))).toEqual({
      prompt: null,
      reply: null,
      recent: [],
    });
  });
});
