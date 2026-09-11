import { describe, expect, test } from "bun:test";
import { describeHarnessSwitch, planHarnessSwitch } from "../src/harness-switch";
import { message, session, text } from "./fixtures";

const conversation = () =>
  session(
    "s1",
    [
      message("m1", "user", [text("b1", "add a button")]),
      message("m2", "assistant", [text("b2", "done")]),
    ],
    { harnessId: "claude-code", cwd: "/repo" },
  );

describe("planHarnessSwitch", () => {
  test("the plan is a new session in the same directory, seeded with the transcript", () => {
    const plan = planHarnessSwitch(conversation(), "codex");

    expect(plan).toMatchObject({
      fromSessionId: "s1",
      fromHarnessId: "claude-code",
      toHarnessId: "codex",
      cwd: "/repo",
    });
    expect(plan?.seed).toContain("User: add a button");
    expect(plan?.characters).toBe(plan!.seed.length);
    expect(plan?.turns).toBe(2);
  });

  test("the harness already running the conversation is not a switch", () => {
    expect(planHarnessSwitch(conversation(), "claude-code")).toBeNull();
    expect(planHarnessSwitch(conversation(), "")).toBeNull();
  });

  test("a session with no working directory has nowhere to be recreated", () => {
    expect(
      planHarnessSwitch(session("s1", [], { harnessId: "claude-code", cwd: null }), "codex"),
    ).toBeNull();
  });

  test("a conversation with nothing in it still switches, on an empty-handed seed", () => {
    const plan = planHarnessSwitch(
      session("s1", [], { harnessId: "claude-code", cwd: "/repo" }),
      "codex",
    );

    expect(plan?.turns).toBe(0);
    expect(plan?.seed).toContain("has not said anything yet");
  });

  test("the budget the seed is built under is the caller’s", () => {
    const short = planHarnessSwitch(conversation(), "codex", 10);
    const full = planHarnessSwitch(conversation(), "codex");

    expect(short!.seed).not.toContain("add a button");
    expect(full!.seed).toContain("add a button");
  });
});

describe("describeHarnessSwitch", () => {
  test("the confirmation says the transcript is re-sent and charged for", () => {
    const plan = planHarnessSwitch(conversation(), "codex")!;
    const confirmation = describeHarnessSwitch(plan, "Codex");

    expect(confirmation.title).toBe("Switch this conversation to Codex?");
    expect(confirmation.body).toContain(
      "replays the entire transcript into its first prompt as plain text",
    );
    expect(confirmation.body).toContain("2 turns");
    expect(confirmation.body).toContain("charged input tokens");
    expect(confirmation.body).toContain("This task is left exactly as it is");
    expect(confirmation.confirmLabel).toBe("Replay and switch to Codex");
    expect(confirmation.cancelLabel).toBe("Keep this harness");
  });

  test("one turn is not counted as turns", () => {
    const plan = planHarnessSwitch(
      session("s1", [message("m1", "user", [text("b1", "hello")])], {
        harnessId: "claude-code",
        cwd: "/repo",
      }),
      "codex",
    )!;

    expect(describeHarnessSwitch(plan, "Codex").body).toContain("1 turn,");
  });
});
