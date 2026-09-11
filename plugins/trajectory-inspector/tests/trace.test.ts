import { describe, expect, test } from "bun:test";
import { type AnyAgentEvent, parseAgentEvent } from "@nib-ui/protocol";
import { buildTrace } from "../src/trace";

const fixturePath = new URL(
  "../../../packages/protocol/tests/fixtures/claude-session.jsonl",
  import.meta.url,
).pathname;

async function fixtureEvents(): Promise<AnyAgentEvent[]> {
  const text = await Bun.file(fixturePath).text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseAgentEvent(JSON.parse(line)));
}

describe("buildTrace", () => {
  test("nests blocks under their message and folds deltas into them", async () => {
    const trace = buildTrace(await fixtureEvents());
    const assistant = trace.find((node) => node.kind === "message" && node.badge === "ASSISTANT");
    const text = trace.find((node) => node.kind === "text");

    expect(assistant?.depth).toBe(0);
    expect(assistant?.turn).toBe(1);
    expect(text?.depth).toBe(1);
    expect(text?.detail).toBe("Listing files.");
    expect(trace.some((node) => node.events.some((event) => event.type === "block.delta"))).toBe(
      true,
    );
  });

  test("a tool call carries the result of its own id", async () => {
    const trace = await fixtureEvents().then(buildTrace);
    const tool = trace.filter((node) => node.kind === "tool");

    expect(tool).toHaveLength(1);
    expect(tool[0]!.title).toBe("Bash");
    expect(tool[0]!.detail).toContain("ls -la");
    expect(tool[0]!.result).toContain("total 0");
    expect(tool[0]!.status).toBe("ok");
  });

  test("numbers turns and steps, and resolves permissions", async () => {
    const trace = await fixtureEvents().then(buildTrace);
    const permission = trace.find((node) => node.kind === "permission");
    const steps = trace.filter((node) => node.depth === 1 && node.step > 0);

    expect(permission?.result).toBe("allow by user");
    expect(permission?.status).toBe("ok");
    expect(steps.map((node) => node.step)).toEqual([1, 2]);
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
