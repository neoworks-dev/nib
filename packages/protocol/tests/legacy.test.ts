import { describe, expect, test } from "bun:test";
import {
  type AnyAgentEvent,
  createLegacyUpgrader,
  createSessionView,
  reduceSessionAll,
  safeParseAgentEvent,
  toolDiffs,
  type ToolItem,
  toolOutputText,
} from "@nib-ui/protocol";

/** Reads a log the way the server does on restore: each line upgraded, then parsed. */
function readLog(text: string): AnyAgentEvent[] {
  const upgrade = createLegacyUpgrader();
  const events: AnyAgentEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const upgraded = upgrade(JSON.parse(line));
    if (upgraded === null) continue;
    const parsed = safeParseAgentEvent(upgraded);
    if (parsed) events.push(parsed);
  }
  return events;
}

const fixture = new URL("./fixtures/legacy-claude-session.jsonl", import.meta.url).pathname;

describe("a log written before nib stored ACP", async () => {
  const text = await Bun.file(fixture).text();
  const events = readLog(text);
  const view = reduceSessionAll(createSessionView("s1"), events);

  test("keeps the sequence numbers of the events that survive", () => {
    const seqs = events.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((left, right) => left - right));
    expect(seqs.at(-1)).toBe(24);
  });

  test("keeps the session's identity, status and logs", () => {
    expect(view.harnessId).toBe("claude-code");
    expect(view.cwd).toBe("/tmp/demo");
    expect(view.nativeSessionId).toBe("native-1");
    expect(view.status).toBe("idle");
    expect(view.logs.map((entry) => entry.message)).toEqual(["turn complete"]);
  });

  test("tells streamed text as one message", () => {
    const [message] = view.items;
    expect(message).toMatchObject({ type: "text", text: "Listing files.", messageId: "m1" });
  });

  test("turns a tool_use and its tool_result into one tool call", () => {
    const tool = view.items.find((item): item is ToolItem => item.type === "tool");
    expect(tool).toMatchObject({
      toolCallId: "tu-1",
      name: "Bash",
      kind: "execute",
      status: "completed",
      rawInput: { command: "ls -la" },
    });
    expect(toolOutputText(tool!)).toBe("total 0\ndrwxr-xr-x 2 user user 40 .");
  });

  test("turns the permission request into an ACP one that resolves", () => {
    expect(view.pendingPermissions).toEqual([]);
    expect(view.resolvedPermissions).toEqual([
      { requestId: "p1", behavior: "allow", resolvedBy: "user" },
    ]);
    const requested = events.find((event) => event.type === "permission.requested");
    expect(requested!.data).toMatchObject({
      requestId: "p1",
      request: { toolCall: { name: "Bash", rawInput: { command: "ls -la" } } },
    });
  });

  test("turns the usage totals into the new usage event", () => {
    expect(view.usage).toMatchObject({
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 900,
      costUsd: 0.0123,
    });
  });

  test("keeps events it does not know as unhandled", () => {
    expect(view.unhandled.map((event) => event.type)).toEqual(["harness.telepathy", "ext"]);
  });
});

describe("converting a log's lines", () => {
  /** A pair of lines announcing then finishing one block. */
  function lines(...entries: Array<[string, Record<string, unknown>]>): string {
    return entries
      .map(([type, data], index) =>
        JSON.stringify({ id: `e${index}`, sessionId: "s", seq: index + 1, ts: 1, type, data }),
      )
      .join("\n");
  }

  test("turns a Claude Edit into a diff", () => {
    const events = readLog(
      lines(
        ["message.started", { messageId: "m", role: "assistant" }],
        [
          "block.started",
          { messageId: "m", blockId: "b", kind: "tool_use", toolName: "Edit", toolUseId: "t" },
        ],
        [
          "block.completed",
          {
            blockId: "b",
            content: {
              kind: "tool_use",
              toolName: "Edit",
              toolUseId: "t",
              input: { file_path: "/a/b.txt", old_string: "x", new_string: "y" },
            },
          },
        ],
      ),
    );
    const tool = reduceSessionAll(createSessionView("s"), events).items[0] as ToolItem;
    expect(tool.kind).toBe("edit");
    expect(toolDiffs(tool)).toEqual([{ path: "/a/b.txt", oldText: "x", newText: "y" }]);
    expect(tool.locations).toEqual([{ path: "/a/b.txt" }]);
  });

  test("turns a Claude Write into a diff that creates the file", () => {
    const events = readLog(
      lines(
        ["message.started", { messageId: "m", role: "assistant" }],
        [
          "block.started",
          { messageId: "m", blockId: "b", kind: "tool_use", toolName: "Write", toolUseId: "t" },
        ],
        [
          "block.completed",
          {
            blockId: "b",
            content: {
              kind: "tool_use",
              toolName: "Write",
              toolUseId: "t",
              input: { file_path: "/a/new.txt", content: "hello" },
            },
          },
        ],
      ),
    );
    const tool = reduceSessionAll(createSessionView("s"), events).items[0] as ToolItem;
    expect(toolDiffs(tool)).toEqual([{ path: "/a/new.txt", oldText: null, newText: "hello" }]);
  });

  test("turns a failed tool_result into a failed call", () => {
    const events = readLog(
      lines(
        ["message.started", { messageId: "m", role: "assistant" }],
        [
          "block.started",
          { messageId: "m", blockId: "b", kind: "tool_use", toolName: "Bash", toolUseId: "t" },
        ],
        ["message.started", { messageId: "u", role: "user" }],
        ["block.started", { messageId: "u", blockId: "r", kind: "tool_result", toolUseId: "t" }],
        [
          "block.completed",
          {
            blockId: "r",
            content: { kind: "tool_result", toolUseId: "t", output: "boom", isError: true },
          },
        ],
      ),
    );
    const tool = reduceSessionAll(createSessionView("s"), events).items[0] as ToolItem;
    expect(tool.status).toBe("failed");
    expect(tool.rawOutput).toBe("boom");
  });

  test("turns thinking into a thought and a prompt into a user message with its attachments", () => {
    const attachments = [{ assetId: "a1", mime: "image/png", name: "shot.png" }];
    const events = readLog(
      lines(
        ["message.started", { messageId: "u", role: "user", attachments }],
        ["block.started", { messageId: "u", blockId: "ub", kind: "text" }],
        ["block.completed", { blockId: "ub", content: { kind: "text", text: "look" } }],
        ["message.started", { messageId: "m", role: "assistant" }],
        ["block.started", { messageId: "m", blockId: "tb", kind: "thinking" }],
        ["block.completed", { blockId: "tb", content: { kind: "thinking", text: "hmm" } }],
      ),
    );
    const view = reduceSessionAll(createSessionView("s"), events);
    expect(view.items).toMatchObject([
      { type: "user", text: "look", attachments },
      { type: "thought", text: "hmm" },
    ]);
  });

  test("lets lines already in the new format through untouched", () => {
    const line = {
      id: "e1",
      sessionId: "s",
      seq: 1,
      ts: 1,
      type: "user.message",
      data: { text: "hi" },
    };
    expect(createLegacyUpgrader()(line)).toBe(line);
  });

  test("drops the per-turn checkpoints, which have no equivalent", () => {
    const upgrade = createLegacyUpgrader();
    const line = {
      id: "e1",
      sessionId: "s",
      seq: 1,
      ts: 1,
      type: "message.checkpoint",
      data: { messageId: "m", checkpointId: "c" },
    };
    expect(upgrade(line)).toBeNull();
  });
});
