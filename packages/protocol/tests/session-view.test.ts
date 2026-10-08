import { describe, expect, test } from "bun:test";
import type { RequestPermissionRequest } from "@neoworks/harness";
import {
  createSessionView,
  type EmittedEvent,
  type MessageItem,
  permissionPreviewTool,
  reduceSession,
  safeParseAgentEvent,
  type SessionUpdate,
  sessionCommandSchema,
  sessionDigest,
  subagentItems,
  type ToolItem,
  transcriptTurns,
} from "@nib-ui/protocol";
import { project, stamp } from "./acp-capture";

function update(value: unknown): EmittedEvent {
  return { type: "update", data: { update: value as SessionUpdate } };
}

function chunk(text: string, extra: Record<string, unknown> = {}): EmittedEvent {
  return update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text }, ...extra });
}

function view(events: EmittedEvent[]) {
  return project("s1", stamp("s1", events));
}

const editRequest: RequestPermissionRequest = {
  sessionId: "native",
  toolCall: {
    toolCallId: "t1",
    title: "Edit a.txt",
    kind: "edit",
    rawInput: { file_path: "/a.txt" },
    content: [{ type: "diff", path: "/a.txt", oldText: "x", newText: "y" }],
  },
  options: [
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
};

describe("messages", () => {
  test("chunks without an id join until a tool call or a prompt ends the message", () => {
    const result = view([
      chunk("Hel"),
      chunk("lo"),
      update({ sessionUpdate: "tool_call", toolCallId: "t", title: "ls", kind: "execute" }),
      chunk("after"),
      { type: "user.message", data: { text: "next" } },
      chunk("fresh"),
    ]);
    expect(result.items.map((item) => (item.type === "tool" ? "tool" : item.text))).toEqual([
      "Hello",
      "tool",
      "after",
      "next",
      "fresh",
    ]);
  });

  test("a chunk under another message id starts another message", () => {
    const result = view([chunk("a", { messageId: "m1" }), chunk("b", { messageId: "m2" })]);
    expect(result.items).toHaveLength(2);
  });

  test("thoughts and text do not run together", () => {
    const result = view([
      update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hm" } }),
      chunk("ok"),
    ]);
    expect(result.items.map((item) => item.type)).toEqual(["thought", "text"]);
  });

  test("a chunk that is not text is skipped", () => {
    const result = view([
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "image", data: "", mimeType: "image/png" },
      }),
    ]);
    expect(result.items).toEqual([]);
  });
});

describe("tool calls", () => {
  test("a report for a call the log never announced still makes the call", () => {
    const result = view([
      update({ sessionUpdate: "tool_call_update", toolCallId: "t", status: "completed", rawOutput: "ok" }),
    ]);
    expect(result.items[0]).toMatchObject({ type: "tool", toolCallId: "t", status: "completed" });
  });

  test("a later report keeps the fields it leaves out", () => {
    const result = view([
      update({ sessionUpdate: "tool_call", toolCallId: "t", title: "Read a", kind: "read", rawInput: { path: "a" } }),
      update({ sessionUpdate: "tool_call_update", toolCallId: "t", status: "in_progress" }),
    ]);
    expect(result.items[0]).toMatchObject({
      title: "Read a",
      kind: "read",
      status: "in_progress",
      rawInput: { path: "a" },
    });
  });

  test("a diff survives a later report that only carries text", () => {
    const result = view([
      update({
        sessionUpdate: "tool_call",
        toolCallId: "t",
        content: [{ type: "diff", path: "/a", oldText: null, newText: "n" }],
      }),
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "t",
        content: [{ type: "content", content: { type: "text", text: "done" } }],
      }),
    ]);
    const tool = result.items[0] as ToolItem;
    expect(tool.content.map((entry) => entry.type)).toEqual(["diff", "content"]);
  });

  test("a subagent's work is kept apart from the session's own", () => {
    const meta = { neoworks: { parentToolCallId: "task" } };
    const result = view([
      update({ sessionUpdate: "tool_call", toolCallId: "task", kind: "think", name: "Task" }),
      update({ sessionUpdate: "tool_call", toolCallId: "inner", kind: "read", name: "Read", _meta: meta }),
      chunk("inner words", { _meta: meta }),
      chunk("outer words"),
    ]);
    expect(subagentItems(result, "task").map((item) => item.type)).toEqual(["tool", "text"]);
    const turns = transcriptTurns(result);
    expect(turns).toHaveLength(1);
    const turn = turns[0]!;
    expect(turn.type === "agent" && turn.items.map((item) => item.id)).toEqual(["task", result.items[3]!.id]);
  });
});

describe("the plan and the session's own fields", () => {
  test("the latest plan replaces the one before", () => {
    const result = view([
      update({ sessionUpdate: "plan", entries: [{ content: "a", status: "pending", priority: "high" }] }),
      update({ sessionUpdate: "plan", entries: [{ content: "b", status: "completed", priority: "low" }] }),
    ]);
    expect(result.plan.map((entry) => entry.content)).toEqual(["b"]);
  });

  test("a title from the harness names the session, and a later label wins", () => {
    const result = view([
      update({ sessionUpdate: "session_info_update", title: "From harness" }),
      { type: "session.meta", data: { label: "Mine" } },
    ]);
    expect(result.title).toBe("Mine");
  });

  test("a partial meta update keeps what it omits", () => {
    const result = view([
      { type: "session.meta", data: { model: "opus", permissionMode: "ask" } },
      { type: "session.meta", data: { effort: "high" } },
    ]);
    expect(result).toMatchObject({ model: "opus", permissionMode: "ask", effort: "high" });
  });

  test("clearing the conversation empties the transcript but not the session", () => {
    const result = view([
      { type: "session.meta", data: { model: "opus" } },
      { type: "user.message", data: { text: "hi" } },
      chunk("hello"),
      { type: "session.cleared", data: { nativeSessionId: "n2" } },
    ]);
    expect(result.items).toEqual([]);
    expect(result.model).toBe("opus");
    expect(result.nativeSessionId).toBe("n2");
  });
});

describe("permissions", () => {
  test("a request is pending until it is resolved, and asking twice is one request", () => {
    const requested: EmittedEvent = {
      type: "permission.requested",
      data: { requestId: "r1", request: editRequest },
    };
    const pending = view([requested, requested]);
    expect(pending.pendingPermissions).toHaveLength(1);

    const resolved = view([
      requested,
      { type: "permission.resolved", data: { requestId: "r1", behavior: "deny", resolvedBy: "user" } },
    ]);
    expect(resolved.pendingPermissions).toEqual([]);
    expect(resolved.resolvedPermissions).toEqual([
      { requestId: "r1", behavior: "deny", resolvedBy: "user" },
    ]);
  });

  test("previews a call the transcript does not hold yet from the request", () => {
    const result = view([{ type: "permission.requested", data: { requestId: "r1", request: editRequest } }]);
    const preview = permissionPreviewTool(result, result.pendingPermissions[0]!);
    expect(preview).toMatchObject({ type: "tool", kind: "edit", rawInput: { file_path: "/a.txt" } });
    expect(preview.content).toHaveLength(1);
  });

  test("previews the live call once the harness has reported it", () => {
    const result = view([
      update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Edit a.txt", kind: "edit" }),
      { type: "permission.requested", data: { requestId: "r1", request: editRequest } },
    ]);
    const preview = permissionPreviewTool(result, result.pendingPermissions[0]!);
    expect(preview).toBe(result.items[0] as ToolItem);
  });
});

describe("tolerance", () => {
  test("events at or below lastSeq are ignored", () => {
    const [first] = stamp("s1", [{ type: "session.status", data: { status: "working" } }]);
    const once = reduceSession(createSessionView("s1"), first!);
    expect(reduceSession(once, first!)).toBe(once);
  });

  test("an event type this build does not know is kept, not fatal", () => {
    const parsed = safeParseAgentEvent({
      id: "e",
      sessionId: "s1",
      seq: 1,
      ts: 1,
      type: "harness.telepathy",
      data: { x: 1 },
    });
    expect(parsed).not.toBeNull();
    expect(reduceSession(createSessionView("s1"), parsed!).unhandled).toHaveLength(1);
  });

  test("a known event type with malformed data fails to parse rather than corrupting state", () => {
    const envelope = { id: "e", sessionId: "s1", seq: 1, ts: 1 };
    expect(safeParseAgentEvent({ ...envelope, type: "update", data: { update: 3 } })).toBeNull();
    expect(safeParseAgentEvent({ ...envelope, type: "user.message", data: { text: 3 } })).toBeNull();
    expect(
      safeParseAgentEvent({ ...envelope, type: "permission.requested", data: { requestId: "r" } }),
    ).toBeNull();
  });
});

describe("the digest", () => {
  test("takes the opening prompt and the newest reply, and keeps only the end of a long chat", () => {
    const events: EmittedEvent[] = [];
    for (let turn = 0; turn < 12; turn += 1) {
      events.push({ type: "user.message", data: { text: `ask ${turn}` } });
      events.push(chunk(`say ${turn}`));
      events.push({ type: "turn.done", data: { stopReason: "end_turn" } });
    }
    const digest = sessionDigest(view(events));
    expect(digest.prompt).toBe("ask 0");
    expect(digest.reply).toBe("say 11");
    expect(digest.recent).toHaveLength(8);
    expect(digest.recent.at(-1)).toEqual({ role: "assistant", text: "say 11" });
  });

  test("leaves tool calls, thoughts and empty messages out", () => {
    const digest = sessionDigest(
      view([
        { type: "user.message", data: { text: "go" } },
        update({ sessionUpdate: "tool_call", toolCallId: "t", kind: "read" }),
        chunk("   "),
      ]),
    );
    expect(digest).toEqual({ prompt: "go", reply: null, recent: [] });
  });

  test("clips a long message", () => {
    const digest = sessionDigest(
      view([
        { type: "user.message", data: { text: "go" } },
        chunk("x".repeat(1000)),
      ]),
    );
    expect(digest.recent[0]!.text.length).toBeLessThan(400);
    expect(digest.reply!.length).toBe(1000);
  });
});

describe("commands", () => {
  test("valid commands parse and unknown ones are rejected", () => {
    expect(sessionCommandSchema.safeParse({ type: "session.interrupt" }).success).toBe(true);
    expect(sessionCommandSchema.safeParse({ type: "session.rewind", messageId: "m" }).success).toBe(false);
    expect(sessionCommandSchema.safeParse({ type: "session.send" }).success).toBe(false);
  });
});

describe("a message item's identity", () => {
  test("is the event that carried its first chunk, so it keys a list", () => {
    const stamped = stamp("s1", [chunk("a"), chunk("b")]);
    const result = project("s1", stamped);
    expect((result.items[0] as MessageItem).id).toBe(stamped[0]!.id);
  });
});
