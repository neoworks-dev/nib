import { describe, expect, test } from "bun:test";
import {
  sessionOf,
  textItem,
  thoughtItem,
  toolItem,
  userItem,
} from "../../../packages/protocol/tests/builders";
import { DROPPED_MARKER, handoverSeed, transcriptText } from "../src/transcript";

describe("transcriptText", () => {
  test("a conversation that has not started yet replays as nothing", () => {
    expect(transcriptText(sessionOf("s1", []))).toBe("");
  });

  test("a message with nothing in it is not a turn", () => {
    expect(transcriptText(sessionOf("s1", [userItem("u1", ""), textItem("a1", "  ")]))).toBe("");
  });

  test("every turn is written out, oldest first, named by who said it", () => {
    const replay = transcriptText(
      sessionOf("s1", [
        userItem("u1", "add a button"),
        textItem("a1", "done"),
        userItem("u2", "now style it"),
        textItem("a2", "styled"),
      ]),
    );

    expect(replay).toBe(
      "User: add a button\n\nAssistant: done\n\nUser: now style it\n\nAssistant: styled",
    );
  });

  test("a tool call becomes the phrase the turn card shows; its output stays behind", () => {
    const replay = transcriptText(
      sessionOf("s1", [
        userItem("u1", "look around"),
        textItem("a1", "checking"),
        thoughtItem("th1", "hmm, which files"),
        toolItem("t1", "Bash", { command: "git status" }, { rawOutput: "nothing to commit" }),
        toolItem("t2", "read", { path: "/repo/src/index.ts" }),
      ]),
    );

    expect(replay).toBe(
      "User: look around\n\nAssistant: checking\n[Ran git status]\n[Read index.ts]",
    );
  });

  test("a subagent's work is not the conversation's", () => {
    const replay = transcriptText(
      sessionOf("s1", [
        userItem("u1", "delegate"),
        toolItem("task", "Task", { description: "dig" }),
        toolItem("inner", "Read", { file_path: "/a.ts" }, { parentToolCallId: "task" }),
      ]),
    );

    expect(replay).toBe("User: delegate\n\nAssistant: [Delegated dig]");
  });

  test("the newest turn goes in whatever it costs, even alone over budget", () => {
    const long = "x".repeat(500);
    const replay = transcriptText(sessionOf("s1", [userItem("u1", long)]), 10);

    expect(replay).toBe(`User: ${long}`);
  });

  test("past the budget the oldest turns drop off and say so", () => {
    const replay = transcriptText(
      sessionOf("s1", [
        userItem("u1", "the first thing"),
        textItem("a1", "the second thing"),
        userItem("u2", "the third thing"),
      ]),
      30,
    );

    expect(replay).toBe(`${DROPPED_MARKER}\n\nUser: the third thing`);
    expect(replay).not.toContain("the first thing");
  });
});

describe("handoverSeed", () => {
  test("the transcript is framed as work already done, between markers", () => {
    const seed = handoverSeed(
      sessionOf("s1", [userItem("u1", "add a button"), textItem("a1", "done")]),
    );

    expect(seed).toContain("ran on another agent");
    expect(seed).toContain(
      "--- transcript begins ---\nUser: add a button\n\nAssistant: done\n--- transcript ends ---",
    );
    expect(seed).toContain("Do not repeat it.");
  });

  test("an empty conversation still seeds a prompt, without empty markers", () => {
    const seed = handoverSeed(sessionOf("s1", []));

    expect(seed).not.toContain("--- transcript begins ---");
    expect(seed).toContain("has not said anything yet");
  });
});
