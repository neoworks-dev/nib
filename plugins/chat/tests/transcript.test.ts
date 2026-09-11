import { describe, expect, test } from "bun:test";
import { DROPPED_MARKER, handoverSeed, transcriptText } from "../src/transcript";
import { message, session, text, toolResult, toolUse } from "./fixtures";

describe("transcriptText", () => {
  test("a conversation that has not started yet replays as nothing", () => {
    expect(transcriptText(session("s1", []))).toBe("");
  });

  test("a message with nothing in it is not a turn", () => {
    expect(
      transcriptText(
        session("s1", [message("m1", "user", []), message("m2", "assistant", [text("b1", "  ")])]),
      ),
    ).toBe("");
  });

  test("every turn is written out, oldest first, named by who said it", () => {
    const replay = transcriptText(
      session("s1", [
        message("m1", "user", [text("b1", "add a button")]),
        message("m2", "assistant", [text("b2", "done")]),
        message("m3", "user", [text("b3", "now style it")]),
        message("m4", "assistant", [text("b4", "styled")]),
      ]),
    );

    expect(replay).toBe(
      "User: add a button\n\nAssistant: done\n\nUser: now style it\n\nAssistant: styled",
    );
  });

  test("a tool call becomes the phrase the turn card shows; its output stays behind", () => {
    const replay = transcriptText(
      session("s1", [
        message("m1", "user", [text("b1", "look around")]),
        message("m2", "assistant", [
          text("b2", "checking"),
          toolUse("t1", "Bash", { command: "git status" }),
          toolUse("t2", "Read", { file_path: "/repo/src/index.ts" }),
        ]),
        message("m3", "user", [toolResult("t1", "nothing to commit")]),
      ]),
    );

    expect(replay).toBe(
      "User: look around\n\nAssistant: checking\n[Ran git status]\n[Read index.ts]",
    );
  });

  test("the newest turn goes in whatever it costs, even alone over budget", () => {
    const long = "x".repeat(500);
    const replay = transcriptText(session("s1", [message("m1", "user", [text("b1", long)])]), 10);

    expect(replay).toBe(`User: ${long}`);
  });

  test("past the budget the oldest turns drop off and say so", () => {
    const replay = transcriptText(
      session("s1", [
        message("m1", "user", [text("b1", "the first thing")]),
        message("m2", "assistant", [text("b2", "the second thing")]),
        message("m3", "user", [text("b3", "the third thing")]),
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
      session("s1", [
        message("m1", "user", [text("b1", "add a button")]),
        message("m2", "assistant", [text("b2", "done")]),
      ]),
    );

    expect(seed).toContain("ran on another agent");
    expect(seed).toContain(
      "--- transcript begins ---\nUser: add a button\n\nAssistant: done\n--- transcript ends ---",
    );
    expect(seed).toContain("Do not repeat it.");
  });

  test("an empty conversation still seeds a prompt, without empty markers", () => {
    const seed = handoverSeed(session("s1", []));

    expect(seed).not.toContain("--- transcript begins ---");
    expect(seed).toContain("has not said anything yet");
  });
});
