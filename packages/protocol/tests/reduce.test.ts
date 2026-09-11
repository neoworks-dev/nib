import { describe, expect, test } from "bun:test";
import {
  type AnyAgentEvent,
  createSessionView,
  parseAgentEvent,
  reduceSession,
  reduceSessionAll,
  type SessionView,
  safeParseAgentEvent,
  sessionCommandSchema,
} from "@nib-ui/protocol";

const fixturePath = new URL("./fixtures/claude-session.jsonl", import.meta.url).pathname;

async function loadFixture(): Promise<AnyAgentEvent[]> {
  const text = await Bun.file(fixturePath).text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseAgentEvent(JSON.parse(line)));
}

function project(events: AnyAgentEvent[]): SessionView {
  return reduceSessionAll(createSessionView("s1"), events);
}

describe("reduceSession over a recorded stream", () => {
  test("projects messages, blocks, usage and status", async () => {
    const view = project(await loadFixture());

    expect(view.harnessId).toBe("claude-code");
    expect(view.cwd).toBe("/tmp/demo");
    expect(view.nativeSessionId).toBe("native-1");
    expect(view.capabilities?.interrupt).toBe(true);
    expect(view.status).toBe("idle");
    expect(view.messages.map((message) => message.id)).toEqual(["m1", "m2"]);

    const [assistant, user] = view.messages;
    expect(assistant!.role).toBe("assistant");
    expect(assistant!.completed).toBe(true);
    expect(assistant!.stopReason).toBe("tool_use");
    expect(assistant!.blocks.map((block) => block.kind)).toEqual(["text", "tool_use"]);
    expect(assistant!.blocks[0]!.text).toBe("Listing files.");
    expect(assistant!.blocks[1]!.toolName).toBe("Bash");
    expect(assistant!.blocks[1]!.inputJson).toBe('{"command":"ls -la"}');
    expect(assistant!.blocks[1]!.content).toEqual({
      kind: "tool_use",
      toolName: "Bash",
      toolUseId: "tu-1",
      input: { command: "ls -la" },
    });
    expect(user!.blocks[0]!.kind).toBe("tool_result");

    expect(view.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 900,
      costUsd: 0.0123,
    });
    expect(view.logs).toEqual([{ level: "info", message: "turn complete", ts: 1022 }]);
    expect(view.lastSeq).toBe(24);
  });

  test("permission requests are pending until resolved", async () => {
    const events = await loadFixture();
    const beforeResolution = project(events.slice(0, 14));
    expect(beforeResolution.pendingPermissions).toEqual([
      { requestId: "p1", toolName: "Bash", input: { command: "ls -la" }, suggestions: [] },
    ]);

    const afterResolution = project(events);
    expect(afterResolution.pendingPermissions).toEqual([]);
    expect(afterResolution.resolvedPermissions).toEqual([
      { requestId: "p1", behavior: "allow", resolvedBy: "user" },
    ]);
  });

  test("unknown event types and ext events are preserved, not fatal", async () => {
    const view = project(await loadFixture());
    expect(view.unhandled.map((event) => event.type)).toEqual(["harness.telepathy", "ext"]);
    expect(view.unhandled[1]!.raw).toEqual({ type: "system", subtype: "compact_boundary" });
  });

  test("replaying the stream twice is idempotent", async () => {
    const events = await loadFixture();
    const once = project(events);
    const twice = reduceSessionAll(once, events);
    expect(twice).toEqual(once);
  });

  test("the reducer does not mutate the previous state", async () => {
    const events = await loadFixture();
    const initial = createSessionView("s1");
    const snapshot = structuredClone(initial);
    reduceSessionAll(initial, events);
    expect(initial).toEqual(snapshot);
  });
});

describe("tolerance", () => {
  function event(seq: number, type: string, data: unknown): AnyAgentEvent {
    return parseAgentEvent({ id: `e${seq}`, sessionId: "s1", seq, ts: seq, type, data });
  }

  test("deltas arriving before block.started are buffered and merged", () => {
    const view = project([
      event(1, "message.started", { messageId: "m1", role: "assistant" }),
      event(2, "block.delta", { blockId: "b1", textDelta: "early " }),
      event(3, "block.delta", { blockId: "b1", textDelta: "bird" }),
      event(4, "block.started", { messageId: "m1", blockId: "b1", kind: "text" }),
      event(5, "block.delta", { blockId: "b1", textDelta: "!" }),
    ]);

    expect(view.messages[0]!.blocks[0]!.text).toBe("early bird!");
    expect(view.orphanBlocks).toEqual({});
  });

  test("block.completed before block.started still wins over deltas", () => {
    const view = project([
      event(1, "block.completed", { blockId: "b1", content: { kind: "text", text: "final" } }),
      event(2, "block.delta", { blockId: "b1", textDelta: "stale" }),
      event(3, "block.started", { messageId: "m1", blockId: "b1", kind: "text" }),
    ]);

    const block = view.messages[0]!.blocks[0]!;
    expect(block.text).toBe("final");
    expect(block.completed).toBe(true);
    expect(view.messages[0]!.role).toBe("assistant");
  });

  test("deltas after completion do not overwrite the completed content", () => {
    const view = project([
      event(1, "block.started", { messageId: "m1", blockId: "b1", kind: "text" }),
      event(2, "block.completed", { blockId: "b1", content: { kind: "text", text: "done" } }),
      event(3, "block.delta", { blockId: "b1", textDelta: " late" }),
    ]);
    expect(view.messages[0]!.blocks[0]!.text).toBe("done");
  });

  test("unknown block kinds and unknown content shapes survive", () => {
    const view = project([
      event(1, "block.started", { messageId: "m1", blockId: "b1", kind: "hologram" }),
      event(2, "block.completed", { blockId: "b1", content: { kind: "hologram", frames: 12 } }),
    ]);

    const block = view.messages[0]!.blocks[0]!;
    expect(block.kind).toBe("hologram");
    expect(block.content).toEqual({ kind: "hologram", frames: 12 });
  });

  test("events at or below lastSeq are ignored", () => {
    const first = reduceSession(
      createSessionView("s1"),
      event(5, "session.status", { status: "working" }),
    );
    const replayed = reduceSession(first, event(5, "session.status", { status: "error" }));
    expect(replayed).toBe(first);
    expect(replayed.status).toBe("working");
  });

  test("a known event type with malformed data fails to parse rather than corrupting state", () => {
    expect(
      safeParseAgentEvent({
        id: "x",
        sessionId: "s1",
        seq: 1,
        ts: 1,
        type: "usage.updated",
        data: {},
      }),
    ).toBeNull();
    expect(
      safeParseAgentEvent({
        id: "x",
        sessionId: "s1",
        seq: 1,
        ts: 1,
        type: "totally.made.up",
        data: { a: 1 },
      }),
    ).not.toBeNull();
  });

  test("duplicate permission requests are idempotent", () => {
    const view = project([
      event(1, "permission.requested", { requestId: "p1", toolName: "Bash", input: {} }),
      event(2, "permission.requested", { requestId: "p1", toolName: "Bash", input: {} }),
    ]);
    expect(view.pendingPermissions).toHaveLength(1);
  });
});

describe("session.meta", () => {
  function meta(seq: number, data: unknown): AnyAgentEvent {
    return parseAgentEvent({
      id: `e${seq}`,
      sessionId: "s1",
      seq,
      ts: seq,
      type: "session.meta",
      data,
    });
  }

  test("carries label, model, permission mode, slash commands and models", () => {
    const view = project([
      meta(1, {
        label: "Refactor the reducer",
        model: "claude-opus-5",
        permissionMode: "acceptEdits",
        slashCommands: [{ name: "review", description: "review the diff", argumentHint: "<path>" }],
        models: [{ id: "claude-opus-5", displayName: "Opus 5" }],
      }),
    ]);

    expect(view.title).toBe("Refactor the reducer");
    expect(view.model).toBe("claude-opus-5");
    expect(view.permissionMode).toBe("acceptEdits");
    expect(view.slashCommands).toEqual([
      { name: "review", description: "review the diff", argumentHint: "<path>" },
    ]);
    expect(view.models).toEqual([{ id: "claude-opus-5", displayName: "Opus 5" }]);
  });

  test("a partial update keeps the fields it omits", () => {
    const view = project([
      meta(1, { label: "first", model: "claude-opus-5", slashCommands: [{ name: "review" }] }),
      meta(2, { permissionMode: "plan" }),
    ]);

    expect(view.title).toBe("first");
    expect(view.model).toBe("claude-opus-5");
    expect(view.slashCommands).toHaveLength(1);
    expect(view.permissionMode).toBe("plan");
  });

  test("a later label wins over the one session.created carried", () => {
    const view = project([
      parseAgentEvent({
        id: "e1",
        sessionId: "s1",
        seq: 1,
        ts: 1,
        type: "session.created",
        data: {
          harnessId: "claude-code",
          cwd: "/tmp/demo",
          title: "from create",
          capabilities: {
            interrupt: true,
            permissionModes: ["default"],
            resume: true,
            fork: true,
            slashCommands: true,
            models: true,
          },
        },
      }),
      meta(2, { label: "renamed by the user" }),
    ]);

    expect(view.title).toBe("renamed by the user");
  });
});

describe("attachments", () => {
  function started(seq: number, data: unknown): AnyAgentEvent {
    return parseAgentEvent({
      id: `e${seq}`,
      sessionId: "s1",
      seq,
      ts: seq,
      type: "message.started",
      data,
    });
  }

  const shot = { assetId: `${"a".repeat(64)}.png`, mime: "image/png", name: "shot.png" };

  test("a user message carries what was attached to it", () => {
    const view = project([
      started(1, { messageId: "m1", role: "user", attachments: [shot] }),
      parseAgentEvent({
        id: "e2",
        sessionId: "s1",
        seq: 2,
        ts: 2,
        type: "block.completed",
        data: { blockId: "m1:0", content: { kind: "text", text: "look at this" } },
      }),
    ]);

    expect(view.messages[0]!.attachments).toEqual([shot]);
  });

  test("an event logged before attachments existed reduces to none", () => {
    const view = project([started(1, { messageId: "m1", role: "user" })]);

    expect(view.messages[0]!.attachments).toEqual([]);
  });

  test("a message the harness produced is never given attachments", () => {
    const view = project([
      started(1, { messageId: "m1", role: "user", attachments: [shot] }),
      started(2, { messageId: "m2", role: "assistant" }),
    ]);

    expect(view.messages[1]!.attachments).toEqual([]);
  });

  test("a replayed message.started does not restate the attachments", () => {
    const view = project([
      started(1, { messageId: "m1", role: "user", attachments: [shot] }),
      started(2, { messageId: "m1", role: "user", attachments: [shot, shot] }),
    ]);

    expect(view.messages).toHaveLength(1);
    expect(view.messages[0]!.attachments).toEqual([shot]);
  });

  test("malformed attachment metadata fails to parse rather than corrupting the message", () => {
    expect(
      safeParseAgentEvent({
        id: "x",
        sessionId: "s1",
        seq: 1,
        ts: 1,
        type: "message.started",
        data: { messageId: "m1", role: "user", attachments: [{ assetId: "a.png" }] },
      }),
    ).toBeNull();
  });
});

describe("commands", () => {
  test("valid commands parse and unknown ones are rejected", () => {
    expect(sessionCommandSchema.parse({ type: "session.send", text: "hi" })).toEqual({
      type: "session.send",
      text: "hi",
    });
    expect(
      sessionCommandSchema.parse({
        type: "session.permission.respond",
        requestId: "p1",
        behavior: "deny",
      }),
    ).toMatchObject({ behavior: "deny" });
    expect(
      sessionCommandSchema.parse({ type: "session.setModel", model: "claude-opus-5" }),
    ).toMatchObject({
      model: "claude-opus-5",
    });
    expect(
      sessionCommandSchema.parse({ type: "session.setLabel", label: "nightly run" }),
    ).toMatchObject({
      label: "nightly run",
    });
    expect(sessionCommandSchema.safeParse({ type: "session.explode" }).success).toBe(false);
    expect(sessionCommandSchema.safeParse({ type: "session.setPermissionMode" }).success).toBe(
      false,
    );
  });

  test("session.send takes attachments, and text stays required", () => {
    const attachments = [{ assetId: `${"a".repeat(64)}.png`, mime: "image/png", name: "shot.png" }];

    expect(sessionCommandSchema.parse({ type: "session.send", text: "look", attachments })).toEqual(
      {
        type: "session.send",
        text: "look",
        attachments,
      },
    );
    expect(sessionCommandSchema.safeParse({ type: "session.send", attachments }).success).toBe(
      false,
    );
    expect(
      sessionCommandSchema.safeParse({
        type: "session.send",
        text: "look",
        attachments: [{ assetId: "a.png" }],
      }).success,
    ).toBe(false);
    expect(
      sessionCommandSchema.safeParse({
        type: "session.send",
        text: "look",
        attachments: "shot.png",
      }).success,
    ).toBe(false);
  });
});
