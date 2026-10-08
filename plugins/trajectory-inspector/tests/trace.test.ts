import { describe, expect, test } from "bun:test";
import { loggedCapture } from "../../../packages/protocol/tests/acp-capture";
import { buildTrace } from "../src/trace";

describe("buildTrace", () => {
  test("nests the agent's messages and calls under their prompt", async () => {
    const trace = buildTrace(await loggedCapture("claude", "run it"));
    const prompt = trace.find((node) => node.kind === "message");
    const text = trace.find((node) => node.kind === "text");

    expect(prompt?.badge).toBe("USER");
    expect(prompt?.turn).toBe(1);
    expect(text?.depth).toBe(1);
    expect(text?.detail).toBe("done");
    expect(text?.turn).toBe(1);
  });

  test("a tool call is one row that its updates fill in", async () => {
    const trace = await loggedCapture("claude", "run it").then(buildTrace);
    const tools = trace.filter((node) => node.kind === "tool");

    expect(tools).toHaveLength(4);
    expect(tools[0]!.title).toBe("Bash");
    expect(tools[0]!.detail).toContain("echo hello");
    expect(tools[0]!.status).toBe("ok");
    expect(tools[0]!.events.length).toBeGreaterThan(3);
    expect(tools[2]!.title).toBe("Read");
    expect(tools[2]!.result).toContain("I like apple pie");
  });

  test("numbers turns and steps, and leaves a permission waiting until it is answered", async () => {
    const trace = await loggedCapture("pi", "run it").then(buildTrace);
    const permission = trace.find((node) => node.kind === "permission");
    const steps = trace.filter((node) => node.depth === 1 && node.step > 0 && node.turn === 1);

    expect(permission?.status).toBe("streaming");
    expect(steps.map((node) => node.step)).toEqual([1, 2, 3, 4]);
    expect(trace.filter((node) => node.kind === "message").map((node) => node.turn)).toEqual([
      1, 2,
    ]);
  });

  test("keeps an unknown event type as its own row", () => {
    const trace = buildTrace([
      {
        id: "x1",
        sessionId: "s1",
        seq: 1,
        ts: 1,
        type: "harness.telepathy",
        data: { thought: "hi" },
      },
    ]);

    expect(trace).toHaveLength(1);
    expect(trace[0]!.badge).toBe("EXT");
    expect(trace[0]!.title).toBe("harness.telepathy");
  });
});
