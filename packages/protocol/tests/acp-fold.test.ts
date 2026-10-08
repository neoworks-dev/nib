import { describe, expect, test } from "bun:test";
import {
  type MessageItem,
  reduceSession,
  type SessionView,
  sessionDigest,
  toolDiffs,
  type ToolItem,
  toolInputString,
  toolOutputText,
  type TranscriptItem,
  transcriptTurns,
} from "@nib-ui/protocol";
import { loggedCapture, project } from "./acp-capture";

function tools(view: SessionView): ToolItem[] {
  return view.items.filter((item): item is ToolItem => item.type === "tool");
}

function messages(view: SessionView): MessageItem[] {
  return view.items.filter((item): item is MessageItem => item.type === "text");
}

function describe_(items: TranscriptItem[]): string[] {
  return items.map((item) => item.type);
}

describe("a Claude Code stream", async () => {
  const events = await loggedCapture("claude", "run echo hello, read notes.txt, edit it");
  const view = project("claude", events);

  test("keeps the order the harness reported things in", () => {
    expect(describe_(view.items)).toEqual([
      "user",
      "tool",
      "tool",
      "tool",
      "tool",
      "text",
      "user",
      "text",
    ]);
  });

  test("fills a tool call's input in over its updates", () => {
    const [echo] = tools(view);
    expect(echo!.name).toBe("Bash");
    expect(echo!.kind).toBe("execute");
    expect(echo!.title).toBe("echo hello");
    expect(echo!.rawInput).toEqual({ command: "echo hello", description: "Print hello" });
    expect(toolInputString(echo!, "command")).toBe("echo hello");
  });

  test("collects a shell command's output and exit from its terminal reports", () => {
    const [echo] = tools(view);
    expect(echo!.status).toBe("completed");
    expect(echo!.terminal).toEqual({ output: "hello", exitCode: 0, signal: null, finished: true });
    expect(toolOutputText(echo!)).toBe("hello");
  });

  test("reads a file's result from the call's content", () => {
    const read = tools(view).find((tool) => tool.kind === "read");
    expect(read!.locations[0]!.path).toEndWith("notes.txt");
    expect(read!.status).toBe("completed");
    expect(toolOutputText(read!)).toContain("I like apple pie.");
  });

  test("carries an edit as an ACP diff", () => {
    const edit = tools(view).find((tool) => tool.kind === "edit");
    expect(edit!.name).toBe("Edit");
    expect(toolDiffs(edit!)).toEqual([
      {
        path: expect.stringContaining("notes.txt"),
        oldText: "I like apple pie.",
        newText: "I like pear pie.",
      },
    ]);
    expect(edit!.status).toBe("completed");
  });

  test("holds the edit's permission request until it is answered", () => {
    expect(view.pendingPermissions).toHaveLength(1);
    const [request] = view.pendingPermissions;
    expect(request!.toolName).toBe("Edit");
    expect(request!.toolCallId).toBe(tools(view)[3]!.toolCallId);
    expect(request!.request.options.length).toBeGreaterThan(0);
  });

  test("starts a message for every message id the harness names", () => {
    expect(messages(view).map((message) => [message.text, message.messageId?.slice(0, 4)])).toEqual(
      [
        ["done", "msg_"],
        ["again", "msg_"],
      ],
    );
    expect(messages(view).every((message) => !message.streaming)).toBe(true);
  });

  test("takes usage, the context and the way the turn ended", () => {
    expect(view.usage.inputTokens).toBe(10);
    expect(view.usage.outputTokens).toBe(486);
    expect(view.usage.cacheWriteTokens).toBe(20302);
    expect(view.usage.costUsd).toBeCloseTo(0.00507667);
    expect(view.usage.context).toEqual({ used: 20307, size: 1000000 });
    expect(view.stopReason).toBe("end_turn");
    expect(view.status).toBe("idle");
  });

  test("lists the commands the harness offers", () => {
    expect(view.slashCommands.map((command) => command.name)).toEqual(["comfy", "comfy-build"]);
  });

  test("splits into the prompts and the agent's turns between them", () => {
    const turns = transcriptTurns(view);
    expect(turns.map((turn) => turn.type)).toEqual(["user", "agent", "user", "agent"]);
    const [, first, , second] = turns;
    expect(first!.type === "agent" && first!.items).toHaveLength(5);
    expect(first!.type === "agent" && first!.completed).toBe(true);
    expect(second!.type === "agent" && second!.completed).toBe(true);
  });

  test("replaying the log is a no-op, and the previous state is not mutated", () => {
    const again = events.reduce(reduceSession, view);
    expect(again).toBe(view);
    const before = JSON.stringify(project("claude", events.slice(0, 8)));
    const partial = project("claude", events.slice(0, 8));
    reduceSession(partial, events[8]!);
    expect(JSON.stringify(partial)).toBe(before);
  });

  test("a digest reads the opening prompt and the last reply", () => {
    const digest = sessionDigest(view);
    expect(digest.prompt).toBe("run echo hello, read notes.txt, edit it");
    expect(digest.reply).toBe("again");
    expect(digest.recent.map((turn) => turn.text)).toEqual(["done", "again", "again"]);
  });
});

describe("a pi stream", async () => {
  const events = await loggedCapture("pi", "run echo hello, read notes.txt, edit it");
  const view = project("pi", events);

  test("tells a message with no id from the tool call that ended it", () => {
    expect(describe_(view.items)).toEqual(["user", "tool", "tool", "tool", "text", "user", "text"]);
    expect(messages(view).map((message) => [message.text, message.messageId])).toEqual([
      ["done", null],
      ["again", null],
    ]);
  });

  test("shows a shell command's output from the terminal delta", () => {
    const [bash] = tools(view);
    expect(bash!.name).toBe("bash");
    expect(bash!.kind).toBe("execute");
    expect(bash!.terminal).toEqual({
      output: "hello\n",
      exitCode: 0,
      signal: null,
      finished: true,
    });
    expect(bash!.status).toBe("completed");
  });

  test("reads text from the structured result", () => {
    const read = tools(view).find((tool) => tool.kind === "read");
    expect(toolOutputText(read!)).toBe("I like apple pie.\n");
  });

  test("shows the edit's diff, which pi sends with the first report", () => {
    const edit = tools(view).find((tool) => tool.kind === "edit");
    expect(toolDiffs(edit!)[0]!.newText).toBe("I like pear pie.\n");
    expect(view.pendingPermissions.map((request) => request.toolName)).toEqual(["bash", "edit"]);
  });

  test("ends up idle with the session's cost", () => {
    expect(view.status).toBe("idle");
    expect(view.usage.costUsd).toBeCloseTo(0.0214576);
    expect(view.usage.context).toEqual({ used: 3199, size: 272000 });
  });
});
