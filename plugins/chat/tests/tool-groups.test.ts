import { describe, expect, test } from "bun:test";
import type { MessageItem, ToolItem } from "@nib-ui/protocol";
import { textItem, toolItem } from "../../../packages/protocol/tests/builders";
import { groupCount, groupTurnItems, type ToolGroup } from "../src/tool-groups";

const toolUse = toolItem;

function prose(id: string): MessageItem {
  return textItem(id, "hello");
}

function groups(items: Array<MessageItem | ToolItem>): ToolGroup[] {
  return groupTurnItems(items).flatMap((item) => (item.kind === "group" ? [item.group] : []));
}

describe("groupTurnItems", () => {
  test("collapses adjacent calls of the same kind into one run", () => {
    const [group, ...rest] = groups([
      toolUse("b1", "Bash", { command: "ls" }),
      toolUse("b2", "Bash", { command: "pwd" }),
      toolUse("b3", "Bash", { command: "whoami" }),
    ]);
    expect(rest).toHaveLength(0);
    expect(group?.label).toBe("Terminal");
    expect(group?.tools.map((tool) => tool.id)).toEqual(["b1", "b2", "b3"]);
  });

  test("splits runs that describe different work", () => {
    expect(
      groups([
        toolUse("b1", "Grep", { pattern: "todo" }),
        toolUse("b2", "Read", { file_path: "/a.ts" }),
        toolUse("b3", "Bash", { command: "ls" }),
      ]).map(groupCount),
    ).toEqual(["1 search", "1 file", "1 command"]);
  });

  test("prose between calls breaks the run", () => {
    expect(
      groups([
        toolUse("b1", "Bash", { command: "ls" }),
        prose("t1"),
        toolUse("b2", "Bash", { command: "pwd" }),
      ]),
    ).toHaveLength(2);
  });

  test("keeps non-tool blocks in place", () => {
    const items = groupTurnItems([prose("t1"), toolUse("b1", "Bash", { command: "ls" })]);
    expect(items.map((item) => item.kind)).toEqual(["item", "group"]);
  });

  test("agent-control calls run under one header whichever harness spelled them", () => {
    const [group, ...rest] = groups([
      toolUse("b1", "mcp__nib__send_to_agent", { sessionId: "a1", text: "go" }),
      toolUse("b2", "send_to_agent", { sessionId: "a2", text: "you too" }),
    ]);
    expect(rest).toHaveLength(0);
    expect(group?.label).toBe("Agents");
    expect(groupCount(group!)).toBe("2 messages");
  });

  test("leaves a spawned agent standing in the turn, under either tool name", () => {
    const items = groupTurnItems([
      toolUse("b1", "spawn_agent", { harness: "codex", prompt: "port the API" }),
      toolUse("b2", "mcp__nib__spawn_agent", { harness: "pi", prompt: "review it" }),
      toolUse("b3", "mcp__nib__read_agent", { sessionId: "agent-1", wait: true }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["item", "item", "group"]);
  });
});

describe("groupCount", () => {
  test("pluralizes the run noun", () => {
    const [commands] = groups([
      toolUse("b1", "Bash", { command: "ls" }),
      toolUse("b2", "Bash", { command: "pwd" }),
    ]);
    const [searches] = groups([
      toolUse("g1", "Grep", { pattern: "a" }),
      toolUse("g2", "Glob", { pattern: "b" }),
    ]);
    expect(groupCount(commands!)).toBe("2 commands");
    expect(groupCount(searches!)).toBe("2 searches");
  });
});
