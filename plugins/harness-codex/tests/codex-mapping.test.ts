import { describe, expect, test } from "bun:test";
import type { EmittedEvent } from "@nib-ui/protocol";
import {
  type CodexStreamState,
  createCodexStreamState,
  mapCodexEvent,
  mapUserText,
  parseModelCache,
} from "../src/mapping";

/** Drives the reducer over a stream the way the adapter's read loop does. */
function drain(
  events: unknown[],
  state = createCodexStreamState("/repo"),
): { state: CodexStreamState; events: EmittedEvent[] } {
  const emitted: EmittedEvent[] = [];
  let current = state;
  for (const event of events) {
    const result = mapCodexEvent(current, event);
    current = result.state;
    emitted.push(...result.events);
  }
  return { state: current, events: emitted };
}

function ofType<T extends EmittedEvent["type"]>(events: EmittedEvent[], type: T) {
  return events.filter((event) => event.type === type) as Extract<EmittedEvent, { type: T }>[];
}

describe("mapCodexEvent", () => {
  test("announces the session and its native thread id on thread.started", () => {
    const { state, events } = drain([{ type: "thread.started", thread_id: "thread-1" }]);
    expect(state.threadId).toBe("thread-1");
    expect(ofType(events, "session.created")[0]?.data).toMatchObject({
      harnessId: "codex",
      cwd: "/repo",
      nativeSessionId: "thread-1",
    });
  });

  test("announces the session once, though every turn re-sends thread.started", () => {
    const { events } = drain([
      { type: "thread.started", thread_id: "thread-1" },
      { type: "thread.started", thread_id: "thread-1" },
    ]);
    expect(ofType(events, "session.created")).toHaveLength(1);
  });

  test("opens an assistant message and reports working on turn.started", () => {
    const { events } = drain([{ type: "turn.started" }]);
    expect(ofType(events, "message.started")[0]?.data).toEqual({
      messageId: "turn-1",
      role: "assistant",
    });
    expect(ofType(events, "session.status")[0]?.data).toEqual({ status: "working" });
  });

  test("maps a completed agent_message to a started and completed text block", () => {
    const { events } = drain([
      { type: "turn.started" },
      {
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: "It printed hello." },
      },
    ]);
    expect(ofType(events, "block.started")[0]?.data).toMatchObject({
      messageId: "turn-1",
      blockId: "turn-1:item_0",
      kind: "text",
    });
    expect(ofType(events, "block.completed")[0]?.data).toEqual({
      blockId: "turn-1:item_0",
      content: { kind: "text", text: "It printed hello." },
    });
  });

  test("streams only the unseen tail of a text item across item.updated", () => {
    const { events } = drain([
      { type: "turn.started" },
      { type: "item.started", item: { id: "item_0", type: "agent_message", text: "Hel" } },
      { type: "item.updated", item: { id: "item_0", type: "agent_message", text: "Hello wo" } },
      { type: "item.updated", item: { id: "item_0", type: "agent_message", text: "Hello world" } },
      {
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: "Hello world" },
      },
    ]);
    expect(ofType(events, "block.started")).toHaveLength(1);
    expect(ofType(events, "block.delta").map((event) => event.data.textDelta)).toEqual([
      "Hel",
      "lo wo",
      "rld",
    ]);
  });

  test("maps reasoning items to thinking blocks", () => {
    const { events } = drain([
      { type: "turn.started" },
      {
        type: "item.completed",
        item: { id: "item_0", type: "reasoning", text: "Checking the file." },
      },
    ]);
    expect(ofType(events, "block.completed")[0]?.data.content).toEqual({
      kind: "thinking",
      text: "Checking the file.",
    });
  });

  test("pairs a command_execution with a tool_result block that shares its tool use id", () => {
    const { events } = drain([
      { type: "turn.started" },
      {
        type: "item.started",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "cat a.txt",
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "cat a.txt",
          aggregated_output: "hello\n",
          exit_code: 0,
          status: "completed",
        },
      },
    ]);
    expect(ofType(events, "block.started").map((event) => event.data)).toMatchObject([
      { blockId: "turn-1:item_1", kind: "tool_use", toolName: "shell", toolUseId: "turn-1:item_1" },
      { blockId: "turn-1:item_1:result", kind: "tool_result", toolUseId: "turn-1:item_1" },
    ]);
    expect(ofType(events, "block.completed").at(-1)?.data).toEqual({
      blockId: "turn-1:item_1:result",
      content: {
        kind: "tool_result",
        toolUseId: "turn-1:item_1",
        output: "hello\n",
        isError: false,
      },
    });
  });

  test("flags a non-zero exit code as a failed tool result", () => {
    const { events } = drain([
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          id: "item_0",
          type: "command_execution",
          command: "false",
          aggregated_output: "",
          exit_code: 1,
          status: "completed",
        },
      },
    ]);
    expect(ofType(events, "block.completed").at(-1)?.data.content).toMatchObject({ isError: true });
  });

  test("emits no result block for a web_search, which carries no result payload", () => {
    const { events } = drain([
      { type: "turn.started" },
      { type: "item.completed", item: { id: "item_0", type: "web_search", query: "bun test" } },
    ]);
    expect(ofType(events, "block.started")).toHaveLength(1);
    expect(ofType(events, "block.completed")[0]?.data.content).toEqual({
      kind: "tool_use",
      toolName: "web_search",
      toolUseId: "turn-1:item_0",
      input: { query: "bun test" },
    });
  });

  test("accumulates usage across turns and closes the message on turn.completed", () => {
    const { state, events } = drain([
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 },
      },
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 200, cached_input_tokens: 60, output_tokens: 5 },
      },
    ]);
    expect(ofType(events, "usage.updated").map((event) => event.data)).toEqual([
      { inputTokens: 100, outputTokens: 10, cacheReadTokens: 40 },
      { inputTokens: 300, outputTokens: 15, cacheReadTokens: 100 },
    ]);
    expect(ofType(events, "message.completed").map((event) => event.data.messageId)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(ofType(events, "session.status").at(-1)?.data).toEqual({ status: "idle" });
    expect(state.messageId).toBeNull();
  });

  test("never reports a cost, because Codex does not send one", () => {
    const { events } = drain([
      { type: "turn.started" },
      {
        type: "turn.completed",
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
      },
    ]);
    expect(ofType(events, "usage.updated")[0]?.data.costUsd).toBeUndefined();
  });

  test("keeps blocks of consecutive turns apart even though item ids restart", () => {
    const { events } = drain([
      { type: "turn.started" },
      { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "first" } },
      {
        type: "turn.completed",
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
      },
      { type: "turn.started" },
      { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "second" } },
    ]);
    expect(ofType(events, "block.completed").map((event) => event.data.blockId)).toEqual([
      "turn-1:item_0",
      "turn-2:item_0",
    ]);
  });

  test("synthesizes a message when an item arrives without a turn.started", () => {
    const { events } = drain([
      { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "hi" } },
    ]);
    expect(ofType(events, "message.started")[0]?.data).toEqual({
      messageId: "turn-1",
      role: "assistant",
    });
  });

  test("reports turn.failed and the fatal error event as session errors", () => {
    const failed = drain([
      { type: "turn.started" },
      { type: "turn.failed", error: { message: "usage limit reached" } },
    ]);
    expect(ofType(failed.events, "session.status").at(-1)?.data).toEqual({
      status: "error",
      detail: "usage limit reached",
    });

    const fatal = drain([{ type: "error", message: "stream closed" }]);
    expect(ofType(fatal.events, "session.status")[0]?.data).toEqual({
      status: "error",
      detail: "stream closed",
    });
  });

  test("turns a non-fatal error item into a log rather than conversation content", () => {
    const { events } = drain([
      { type: "turn.started" },
      { type: "item.completed", item: { id: "item_0", type: "error", message: "patch failed" } },
    ]);
    expect(ofType(events, "log")[0]?.data).toEqual({ level: "error", message: "patch failed" });
    expect(ofType(events, "block.started")).toHaveLength(0);
  });

  test("passes an unrecognized event type through as ext without throwing", () => {
    const { events } = drain([{ type: "turn.rolled_back", detail: 42 }]);
    expect(ofType(events, "ext")[0]?.data).toMatchObject({ ns: "codex", type: "turn.rolled_back" });
  });

  test("degrades malformed lines to a warning instead of throwing", () => {
    const malformed = [
      null,
      undefined,
      7,
      "not json",
      [],
      {},
      { type: 9 },
      { type: "item.completed" },
      { type: "item.started", item: { type: "agent_message" } },
    ];
    for (const input of malformed) {
      expect(() => mapCodexEvent(createCodexStreamState("/repo"), input)).not.toThrow();
    }
    const { events } = drain(malformed);
    expect(events).toHaveLength(malformed.length);
    expect(events.every((event) => event.type === "log" && event.data.level === "warn")).toBe(true);
  });

  test("leaves the state untouched when a line cannot be read", () => {
    const before = createCodexStreamState("/repo");
    expect(mapCodexEvent(before, "garbage").state).toBe(before);
  });
});

describe("mapUserText", () => {
  test("echoes the prompt locally as a completed user message", () => {
    const { state, events } = mapUserText(createCodexStreamState("/repo"), "fix the test");
    expect(events.map((event) => event.type)).toEqual([
      "message.started",
      "block.started",
      "block.completed",
      "message.completed",
      "session.status",
    ]);
    expect(ofType(events, "block.completed")[0]?.data).toEqual({
      blockId: "user-1:0",
      content: { kind: "text", text: "fix the test" },
    });
    expect(state.userMessages).toBe(1);
  });

  test("records what was attached on the message that carried it", () => {
    const shot = { assetId: `${"a".repeat(64)}.png`, mime: "image/png", name: "shot.png" };
    const { events } = mapUserText(createCodexStreamState("/repo"), "look at this", [shot]);

    expect(ofType(events, "message.started")[0]?.data.attachments).toEqual([shot]);
  });

  test("gives each prompt its own message id", () => {
    const first = mapUserText(createCodexStreamState("/repo"), "one");
    const second = mapUserText(first.state, "two");
    expect(ofType(second.events, "message.started")[0]?.data.messageId).toBe("user-2");
  });
});

describe("parseModelCache", () => {
  test("keeps listed models and drops internal ones", () => {
    const raw = JSON.stringify({
      models: [
        {
          slug: "gpt-5.6-sol",
          display_name: "GPT-5.6-Sol",
          description: "Latest",
          visibility: "list",
        },
        { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide" },
        { display_name: "nameless", visibility: "list" },
      ],
    });
    expect(parseModelCache(raw)).toEqual([
      { id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol", description: "Latest" },
    ]);
  });

  test("returns nothing for a cache without a model list", () => {
    expect(parseModelCache("{}")).toEqual([]);
    expect(parseModelCache("[]")).toEqual([]);
  });
});
