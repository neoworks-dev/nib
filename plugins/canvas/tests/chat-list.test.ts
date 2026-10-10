import { describe, expect, test } from "bun:test";
import type { SessionSummary } from "@nib-ui/ui-contracts";
import { chatList, chatTitle, groupChats } from "../src/chat-list";

/** A summary with only what the list reads; the rest is filled with defaults. */
function summary(id: string, fields: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    harnessId: "claude-code",
    cwd: "/repo",
    title: id,
    status: "idle",
    model: null,
    archived: false,
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    lastSeq: 0,
    live: true,
    resumable: true,
    nativeSessionId: null,
    parentSessionId: null,
    digest: { prompt: "hi", reply: null, recent: [] },
    ...fields,
  } as SessionSummary;
}

describe("chatList", () => {
  test("leaves out a chat nobody has written in or answered", () => {
    const list = chatList(
      [
        summary("empty", { title: null, digest: { prompt: null, reply: null, recent: [] } }),
        summary("used"),
      ],
      "/repo",
    );

    expect(list.map((entry) => entry.sessionId)).toEqual(["used"]);
  });

  test("lists this project's chats, newest first", () => {
    const list = chatList(
      [
        summary("old", { updatedAt: 1 }),
        summary("new", { updatedAt: 3 }),
        summary("elsewhere", { cwd: "/other", updatedAt: 5 }),
        summary("archived", { archived: true, updatedAt: 4 }),
      ],
      "/repo",
    );

    expect(list.map((entry) => entry.sessionId)).toEqual(["new", "old"]);
  });

  test("marks every chat that is working, so several can run at once", () => {
    const list = chatList(
      [
        summary("a", { status: "working", updatedAt: 2 }),
        summary("b", { status: "idle", updatedAt: 1 }),
        summary("c", { status: "awaiting-permission", updatedAt: 3 }),
      ],
      "/repo",
    );

    expect(list.map((entry) => [entry.sessionId, entry.running, entry.needsInput])).toEqual([
      ["c", true, true],
      ["a", true, false],
      ["b", false, false],
    ]);
  });

  test("folds a spawned agent into its parent's row, running included", () => {
    const list = chatList(
      [
        summary("parent", { updatedAt: 1 }),
        summary("child", { parentSessionId: "parent", status: "working", updatedAt: 9 }),
      ],
      "/repo",
    );

    expect(list).toEqual([
      {
        sessionId: "parent",
        title: "parent",
        updatedAt: 9,
        running: true,
        needsInput: false,
        preview: null,
        pinned: false,
        branchable: false,
      },
    ]);
  });

  test("previews the first line of the newest reply", () => {
    const [entry] = chatList(
      [summary("s", { digest: { prompt: null, reply: "\n  Done.\nMore detail", recent: [] } })],
      "/repo",
    );

    expect(entry?.preview).toBe("Done.");
  });
});

describe("pinned chats", () => {
  test("lead the overview whatever their age, and a fork needs a native id to be offered", () => {
    const now = new Date(2026, 9, 10, 15, 0).getTime();
    const entries = chatList(
      [
        summary("recent", { updatedAt: now }),
        summary("pinned", { updatedAt: now - 1000 * 60 * 60 * 24 * 30, pinned: true }),
        summary("resumable", { nativeSessionId: "n1", resumable: true }),
      ],
      "/repo",
    );

    expect(groupChats(entries, now)[0]?.label).toBe("Pinned");
    expect(entries.find((entry) => entry.sessionId === "resumable")?.branchable).toBe(true);
    expect(entries.find((entry) => entry.sessionId === "recent")?.branchable).toBe(false);
  });
});

describe("groupChats", () => {
  const now = new Date(2026, 9, 10, 15, 0).getTime();
  const hoursAgo = (hours: number): number => now - hours * 60 * 60 * 1000;

  test("puts running chats first, then groups the rest by when they last moved", () => {
    const entries = chatList(
      [
        summary("today", { updatedAt: hoursAgo(2) }),
        summary("running", { updatedAt: hoursAgo(24 * 30), status: "working" }),
        summary("yesterday", { updatedAt: hoursAgo(20) }),
        summary("week", { updatedAt: hoursAgo(24 * 4) }),
        summary("old", { updatedAt: hoursAgo(24 * 30) }),
      ],
      "/repo",
    );

    const groups = groupChats(entries, now).map((group) => [
      group.label,
      group.entries.map((entry) => entry.sessionId),
    ]);
    expect(groups).toEqual([
      ["Running", ["running"]],
      ["Today", ["today"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["week"]],
      ["Older", ["old"]],
    ]);
  });

  test("leaves out a section with nothing in it", () => {
    const entries = chatList([summary("today", { updatedAt: hoursAgo(1) })], "/repo");

    expect(groupChats(entries, now).map((group) => group.label)).toEqual(["Today"]);
  });
});

describe("chatTitle", () => {
  test("falls back to the opening prompt, then to a placeholder", () => {
    const prompted = summary("s", {
      title: null,
      digest: { prompt: "port the engine", reply: null, recent: [] },
    });

    expect(chatTitle(prompted)).toBe("port the engine");
    const unused = summary("s", { title: null, digest: { prompt: null, reply: null, recent: [] } });
    expect(chatTitle(unused)).toBe("Untitled chat");
  });
});
