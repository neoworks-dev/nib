import { describe, expect, test } from "bun:test";
import type { MessageItem, ToolItem } from "@nib-ui/protocol";
import type {
  MessageRendererRegistration,
  PermissionRendererProps,
  PermissionRendererRegistration,
  RendererProps,
  ToolRendererRegistration,
} from "@nib-ui/ui-contracts";
import type { Component } from "svelte";
import {
  matchMessageRenderer,
  matchPermissionRenderer,
  matchToolRenderer,
} from "../src/lib/client/renderer-matching";

const anyTool = {} as Component<RendererProps<ToolItem>>;
const executeKind = {} as Component<RendererProps<ToolItem>>;
const bashByName = {} as Component<RendererProps<ToolItem>>;
const text = {} as Component<RendererProps<MessageItem>>;
const thought = {} as Component<RendererProps<MessageItem>>;
const askQuestion = {} as Component<PermissionRendererProps>;
const askQuestionOverride = {} as Component<PermissionRendererProps>;

const toolRegistrations: ToolRendererRegistration[] = [
  { type: "tool", component: anyTool },
  { type: "tool", toolKind: "execute", priority: 10, component: executeKind },
  { type: "tool", toolName: "Bash", toolKind: "execute", component: bashByName },
];

const messageRegistrations: MessageRendererRegistration[] = [
  { type: "text", component: text },
  { type: "thought", component: thought },
];

const permissionRegistrations: PermissionRendererRegistration[] = [
  { toolName: "AskUserQuestion", component: askQuestion },
  { toolName: "AskUserQuestion", priority: 5, component: askQuestionOverride },
];

function tool(name: string, kind: string): ToolItem {
  return {
    type: "tool",
    id: "t1",
    toolCallId: "t1",
    seq: 1,
    name,
    title: "",
    kind,
    status: "pending",
    rawInput: undefined,
    rawOutput: undefined,
    content: [],
    locations: [],
    terminal: null,
    parentToolCallId: null,
  };
}

function message(type: MessageItem["type"]): MessageItem {
  return {
    type,
    id: "m1",
    seq: 1,
    messageId: null,
    text: "",
    streaming: false,
    parentToolCallId: null,
  };
}

describe("matchToolRenderer", () => {
  test("prefers a renderer naming the tool over one naming its kind", () => {
    expect(matchToolRenderer(toolRegistrations, tool("Bash", "execute"))?.component).toBe(
      bashByName,
    );
  });

  test("matches every harness's shell tool by kind, whatever it calls the tool", () => {
    expect(matchToolRenderer(toolRegistrations, tool("bash", "execute"))?.component).toBe(
      executeKind,
    );
    expect(matchToolRenderer(toolRegistrations, tool("shell", "execute"))?.component).toBe(
      executeKind,
    );
  });

  test("leaves a kind nobody claims to the renderer that claims none", () => {
    expect(matchToolRenderer(toolRegistrations, tool("Read", "read"))?.component).toBe(anyTool);
  });

  test("a registration naming a tool does not match another tool of the same kind", () => {
    const onlyBash = toolRegistrations.filter((entry) => entry.toolName === "Bash");
    expect(matchToolRenderer(onlyBash, tool("bash", "execute"))).toBeUndefined();
  });
});

describe("matchMessageRenderer", () => {
  test("picks the renderer for the message's type", () => {
    expect(matchMessageRenderer(messageRegistrations, message("text"))?.component).toBe(text);
    expect(matchMessageRenderer(messageRegistrations, message("thought"))?.component).toBe(thought);
  });
});

describe("matchPermissionRenderer", () => {
  test("routes a claimed tool to its highest-priority renderer", () => {
    expect(matchPermissionRenderer(permissionRegistrations, "AskUserQuestion")?.component).toBe(
      askQuestionOverride,
    );
  });

  test("leaves unclaimed tools to the fallback card", () => {
    expect(matchPermissionRenderer(permissionRegistrations, "Bash")).toBeUndefined();
    expect(matchPermissionRenderer([], "AskUserQuestion")).toBeUndefined();
  });
});
