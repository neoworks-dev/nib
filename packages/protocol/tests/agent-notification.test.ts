import { describe, expect, test } from "bun:test";
import type { AgentReport } from "../src/agent-control";
import { formatAgentNotification, parseAgentNotification } from "../src/agent-control";

const report: AgentReport = {
  sessionId: "child",
  harness: "pi",
  model: "deepseek/deepseek-v4.1-flash",
  title: "Auditor",
  parentSessionId: "root",
  status: "idle",
  statusDetail: null,
  prompt: "audit the migration",
  reply: "No bugs found.\n\nTwo warnings:\n- a\n- b",
};

describe("agent notifications", () => {
  test("round-trip, result kept whole across lines", () => {
    expect(parseAgentNotification(formatAgentNotification(report))).toEqual({
      sessionId: "child",
      harness: "pi",
      title: "Auditor",
      status: "idle",
      detail: null,
      result: report.reply ?? "",
    });
  });

  test("a failure carries its detail and an untitled agent has no title element", () => {
    const text = formatAgentNotification({
      ...report,
      title: null,
      status: "error",
      statusDetail: "rate limited",
      reply: null,
    });
    expect(text).not.toContain("<title>");
    expect(parseAgentNotification(text)).toMatchObject({
      title: null,
      status: "error",
      detail: "rate limited",
      result: "(the agent said nothing)",
    });
  });

  test("a result that mentions the closing tags still reads to the end", () => {
    const text = formatAgentNotification({
      ...report,
      reply: "wrote </result> and </agent-notification> to a file",
    });
    expect(parseAgentNotification(text)?.result).toBe(
      "wrote </result> and </agent-notification> to a file",
    );
  });

  test("a prompt that talks about notifications is not one", () => {
    expect(parseAgentNotification("send me an <agent-notification> when done")).toBeNull();
    expect(
      parseAgentNotification(
        "<agent-notification>\n<sessionId>x</sessionId>\n</agent-notification>",
      ),
    ).toBeNull();
    expect(
      parseAgentNotification(`${formatAgentNotification(report)}\n\nand also do this`),
    ).toBeNull();
  });
});
