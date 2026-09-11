import { describe, expect, test } from "bun:test";
import type { EmittedEvent } from "@nib-ui/protocol";
import {
  composeModelId,
  createPiStreamState,
  mapPiEvent,
  parseCommands,
  parseModels,
  type PiStreamState,
  queueUserAttachments,
  splitModelId,
} from "../src/mapping";

/** Drives the reducer over a stream the way the adapter's subscription does. */
function drain(
  events: unknown[],
  state = createPiStreamState("/repo", "session-1"),
): { state: PiStreamState; events: EmittedEvent[] } {
  const emitted: EmittedEvent[] = [];
  let current = state;
  for (const event of events) {
    const result = mapPiEvent(current, event);
    current = result.state;
    emitted.push(...result.events);
  }
  return { state: current, events: emitted };
}

function ofType<T extends EmittedEvent["type"]>(
  events: EmittedEvent[],
  type: T,
): Extract<EmittedEvent, { type: T }>[] {
  return events.filter((event): event is Extract<EmittedEvent, { type: T }> => event.type === type);
}

function delta(assistantMessageEvent: Record<string, unknown>): Record<string, unknown> {
  return { type: "message_update", assistantMessageEvent };
}

const assistantStart = { type: "message_start", message: { role: "assistant", content: [] } };

describe("mapPiEvent lifecycle", () => {
  test("agent_start reports working and agent_settled reports idle", () => {
    const { events } = drain([{ type: "agent_start" }, { type: "agent_settled" }]);
    expect(ofType(events, "session.status").map((event) => event.data.status)).toEqual([
      "working",
      "idle",
    ]);
  });

  test("agent_end stays silent so a retry does not look like the end of the run", () => {
    const { events } = drain([{ type: "agent_end", messages: [], willRetry: true }]);
    expect(events).toEqual([]);
  });

  test("turn brackets carry no content of their own", () => {
    const { events } = drain([{ type: "turn_start" }, { type: "turn_end", message: {} }]);
    expect(events).toEqual([]);
  });
});

describe("mapPiEvent user messages", () => {
  test("completes pi's own prompt echo as a single text block", () => {
    const { events } = drain([
      { type: "message_start", message: { role: "user", content: "fix the test" } },
    ]);
    expect(ofType(events, "message.started")[0]?.data).toMatchObject({
      messageId: "msg-1",
      role: "user",
    });
    expect(ofType(events, "block.completed")[0]?.data.content).toEqual({
      kind: "text",
      text: "fix the test",
    });
    expect(ofType(events, "message.completed")[0]?.data.messageId).toBe("msg-1");
  });

  test("reads the text out of a content block array once images are attached", () => {
    const { events } = drain([
      {
        type: "message_start",
        message: {
          role: "user",
          content: [
            { type: "image", data: "…", mimeType: "image/png" },
            { type: "text", text: "what is this" },
          ],
        },
      },
    ]);
    expect(ofType(events, "block.completed")[0]?.data.content).toEqual({
      kind: "text",
      text: "what is this",
    });
  });

  test("attaches queued metadata to the echo and clears it afterwards", () => {
    const queued = queueUserAttachments(createPiStreamState("/repo"), [
      { assetId: "aaa.png", mime: "image/png", name: "shot.png" },
    ]);
    const { state, events } = drain(
      [{ type: "message_start", message: { role: "user", content: "look" } }],
      queued,
    );
    expect(ofType(events, "message.started")[0]?.data.attachments).toEqual([
      { assetId: "aaa.png", mime: "image/png", name: "shot.png" },
    ]);
    expect(state.pendingAttachments).toBeNull();
  });

  test("a prompt with nothing attached carries no attachment metadata", () => {
    const { state, events } = drain([
      { type: "message_start", message: { role: "user", content: "plain" } },
    ]);
    expect(ofType(events, "message.started")[0]?.data.attachments).toBeUndefined();
    expect(state.pendingAttachments).toBeNull();
  });
});

describe("mapPiEvent streaming", () => {
  test("streams a text block through started, delta and completed", () => {
    const { events } = drain([
      assistantStart,
      delta({ type: "text_start", contentIndex: 0 }),
      delta({ type: "text_delta", contentIndex: 0, delta: "Hel" }),
      delta({ type: "text_delta", contentIndex: 0, delta: "lo" }),
      delta({ type: "text_end", contentIndex: 0, content: "Hello" }),
    ]);
    expect(ofType(events, "block.started")[0]?.data).toMatchObject({
      messageId: "msg-1",
      blockId: "msg-1:0",
      kind: "text",
    });
    expect(ofType(events, "block.delta").map((event) => event.data.textDelta)).toEqual([
      "Hel",
      "lo",
    ]);
    expect(ofType(events, "block.completed")[0]?.data.content).toEqual({
      kind: "text",
      text: "Hello",
    });
  });

  test("announces a block once even though every delta names the same index", () => {
    const { events } = drain([
      assistantStart,
      delta({ type: "text_start", contentIndex: 0 }),
      delta({ type: "text_delta", contentIndex: 0, delta: "a" }),
      delta({ type: "text_delta", contentIndex: 0, delta: "b" }),
    ]);
    expect(ofType(events, "block.started")).toHaveLength(1);
  });

  test("maps thinking deltas to a thinking block", () => {
    const { events } = drain([
      assistantStart,
      delta({ type: "thinking_delta", contentIndex: 1, delta: "hmm" }),
      delta({ type: "thinking_end", contentIndex: 1, content: "hmm" }),
    ]);
    expect(ofType(events, "block.started")[0]?.data.kind).toBe("thinking");
    expect(ofType(events, "block.completed")[0]?.data.content).toEqual({
      kind: "thinking",
      text: "hmm",
    });
  });

  test("synthesizes the assistant message when a delta arrives before message_start", () => {
    const { events } = drain([delta({ type: "text_delta", contentIndex: 0, delta: "hi" })]);
    expect(ofType(events, "message.started")[0]?.data).toMatchObject({
      messageId: "msg-1",
      role: "assistant",
    });
  });

  test("streams tool call arguments as an input json delta and completes with the call", () => {
    const { events } = drain([
      assistantStart,
      delta({ type: "toolcall_start", contentIndex: 0, toolName: "bash" }),
      delta({ type: "toolcall_delta", contentIndex: 0, delta: '{"command"' }),
      delta({
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: { id: "call_1", name: "bash", arguments: { command: "ls" } },
      }),
    ]);
    expect(ofType(events, "block.started")[0]?.data).toMatchObject({
      kind: "tool_use",
      toolName: "bash",
    });
    expect(ofType(events, "block.delta")[0]?.data.inputJsonDelta).toBe('{"command"');
    expect(ofType(events, "block.completed")[0]?.data.content).toEqual({
      kind: "tool_use",
      toolName: "bash",
      toolUseId: "call_1",
      input: { command: "ls" },
    });
  });
});

describe("mapPiEvent tool results", () => {
  test("flattens the result content blocks into the tool_result output", () => {
    const { events } = drain([
      assistantStart,
      {
        type: "tool_execution_end",
        toolCallId: "call_1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "total 48" }] },
        isError: false,
      },
    ]);
    expect(ofType(events, "block.completed")[0]?.data).toEqual({
      blockId: "call_1:result",
      content: {
        kind: "tool_result",
        toolUseId: "call_1",
        output: "total 48",
        isError: false,
      },
    });
  });

  test("carries the error flag through", () => {
    const { events } = drain([
      assistantStart,
      {
        type: "tool_execution_end",
        toolCallId: "call_1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "no such file" }] },
        isError: true,
      },
    ]);
    expect(ofType(events, "block.completed")[0]?.data.content).toMatchObject({ isError: true });
  });

  test("a start and a partial update add nothing the call and result do not already carry", () => {
    const { events } = drain([
      { type: "tool_execution_start", toolCallId: "call_1", toolName: "bash" },
      { type: "tool_execution_update", toolCallId: "call_1", partialResult: { content: [] } },
    ]);
    expect(events).toEqual([]);
  });

  test("a result with no id is logged rather than dropped", () => {
    const { events } = drain([{ type: "tool_execution_end", toolName: "bash" }]);
    expect(ofType(events, "log")[0]?.data.level).toBe("warn");
  });
});

describe("mapPiEvent message completion", () => {
  test("closes the message and adds its usage to the running totals", () => {
    const { state, events } = drain([
      assistantStart,
      {
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          usage: {
            input: 383,
            output: 5,
            cacheRead: 12,
            cost: { total: 0.0019 },
          },
        },
      },
    ]);
    expect(ofType(events, "message.completed")[0]?.data).toMatchObject({
      messageId: "msg-1",
      stopReason: "stop",
    });
    expect(ofType(events, "usage.updated")[0]?.data).toEqual({
      inputTokens: 383,
      outputTokens: 5,
      cacheReadTokens: 12,
      costUsd: 0.0019,
    });
    expect(state.messageId).toBeNull();
  });

  test("reports a failed turn from the error the assistant message carries", () => {
    const { events } = drain([
      assistantStart,
      {
        type: "message_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "OAuth refresh failed" },
      },
    ]);
    expect(ofType(events, "session.status")[0]?.data).toEqual({
      status: "error",
      detail: "OAuth refresh failed",
    });
  });

  test("emits no usage event when the message reports none", () => {
    const { events } = drain([
      assistantStart,
      { type: "message_end", message: { role: "assistant" } },
    ]);
    expect(ofType(events, "usage.updated")).toHaveLength(0);
  });
});

describe("mapPiEvent metadata and fallbacks", () => {
  test("a thinking level change becomes session metadata", () => {
    const { events } = drain([{ type: "thinking_level_changed", level: "high" }]);
    expect(ofType(events, "session.meta")[0]?.data).toEqual({ effort: "high" });
  });

  test("a renamed session becomes a label", () => {
    const { events } = drain([{ type: "session_info_changed", name: "my-feature" }]);
    expect(ofType(events, "session.meta")[0]?.data).toEqual({ label: "my-feature" });
  });

  test("an extension error is logged at error level", () => {
    const { events } = drain([{ type: "extension_error", error: "boom" }]);
    expect(ofType(events, "log")[0]?.data).toEqual({ level: "error", message: "boom" });
  });

  test("persistence bookkeeping is not transcript content", () => {
    const { events } = drain([
      { type: "entry_appended", entry: {} },
      { type: "queue_update", steering: [], followUp: [] },
    ]);
    expect(events).toEqual([]);
  });

  test("an unrecognized event survives as an ext passthrough", () => {
    const { events } = drain([{ type: "compaction_start", reason: "threshold" }]);
    expect(ofType(events, "ext")[0]?.data).toMatchObject({ ns: "pi", type: "compaction_start" });
  });

  test("an unreadable payload degrades to a warning instead of throwing", () => {
    expect(() => drain([null, 42, {}, { type: 7 }])).not.toThrow();
    const { events } = drain([null]);
    expect(ofType(events, "log")[0]?.data.level).toBe("warn");
  });
});

describe("model ids", () => {
  test("round-trips a provider and model id through pi's own syntax", () => {
    const id = composeModelId("anthropic", "claude-opus-4-5");
    expect(id).toBe("anthropic/claude-opus-4-5");
    expect(splitModelId(id)).toEqual({ provider: "anthropic", modelId: "claude-opus-4-5" });
  });

  test("keeps a model id that itself contains a slash intact", () => {
    expect(splitModelId("openrouter/meta/llama-3")).toEqual({
      provider: "openrouter",
      modelId: "meta/llama-3",
    });
  });

  test("rejects a string that names no provider", () => {
    expect(splitModelId("default")).toBeNull();
    expect(splitModelId("/orphan")).toBeNull();
    expect(splitModelId("trailing/")).toBeNull();
  });
});

describe("catalog parsing", () => {
  test("addresses every model by provider and id and labels it by name", () => {
    expect(
      parseModels({
        models: [
          { id: "claude-opus-4-5", name: "Claude Opus 4.5", provider: "anthropic" },
          { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "openai-codex" },
        ],
      }),
    ).toEqual([
      {
        id: "anthropic/claude-opus-4-5",
        displayName: "Claude Opus 4.5",
        description: "anthropic",
      },
      { id: "openai-codex/gpt-5.6-sol", displayName: "GPT-5.6 Sol", description: "openai-codex" },
    ]);
  });

  test("skips an entry that cannot be addressed", () => {
    expect(parseModels({ models: [{ id: "orphan" }, "nonsense"] })).toEqual([]);
  });

  test("keeps extension, template and skill commands with their descriptions", () => {
    expect(
      parseCommands({
        commands: [
          { name: "llama", description: "Manage llama.cpp router models" },
          { name: "skill:brave-search" },
          { nope: true },
        ],
      }),
    ).toEqual([
      { name: "llama", description: "Manage llama.cpp router models" },
      { name: "skill:brave-search", description: undefined },
    ]);
  });
});
