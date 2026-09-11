import { describe, expect, test } from "bun:test";
import type { BlockView } from "@nib-ui/protocol";
import { describeCall, describeStep, readFilePath } from "../src/tool-summary";

function toolUse(toolName: string, input: unknown): BlockView {
  return {
    id: `${toolName}-${JSON.stringify(input)}`,
    messageId: "m1",
    kind: "tool_use",
    toolName,
    toolUseId: "tu-1",
    text: "",
    inputJson: "",
    content: { kind: "tool_use", toolName, toolUseId: "tu-1", input },
    completed: true,
  };
}

describe("describeStep", () => {
  test("names the file a read or edit touched", () => {
    expect(describeStep(toolUse("Read", { file_path: "/repo/apps/web/README.md" }))).toBe(
      "Read README.md",
    );
    expect(describeStep(toolUse("Edit", { file_path: "/repo/src/app.ts" }))).toBe("Updated app.ts");
    expect(describeStep(toolUse("Write", { file_path: "/repo/src/new.ts" }))).toBe("Wrote new.ts");
  });

  test("quotes the command a shell call ran", () => {
    expect(describeStep(toolUse("Bash", { command: "node --check app.js" }))).toBe(
      "Ran node --check app.js",
    );
  });

  test("collapses a multi-line command onto one line and clips it", () => {
    const summary = describeStep(toolUse("Bash", { command: `echo one\n${"x".repeat(80)}` }));
    expect(summary.startsWith("Ran echo one x")).toBe(true);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.includes("\n")).toBe(false);
  });

  test("reduces a fetch to its host", () => {
    expect(describeStep(toolUse("WebFetch", { url: "https://example.com/a/b?c=1" }))).toBe(
      "Fetched example.com",
    );
  });

  test("falls back to the tool name it does not know", () => {
    expect(describeStep(toolUse("SomeMcpTool", { anything: 1 }))).toBe("SomeMcpTool");
  });

  test("survives a call whose input never arrived", () => {
    expect(describeStep(toolUse("Read", {}))).toBe("Read a file");
  });
});

function streamingCall(toolName: string, inputJson: string): BlockView {
  return {
    id: `${toolName}-streaming`,
    messageId: "m1",
    kind: "tool_use",
    toolName,
    toolUseId: "tu-2",
    text: "",
    inputJson,
    content: null,
    completed: false,
  };
}

describe("describeCall", () => {
  test("reads the command out of half-arrived input", () => {
    expect(describeCall(streamingCall("Bash", '{"command": "git status --por')).detail).toBe(
      "git status --por",
    );
    expect(describeCall(streamingCall("Bash", '{"command": "echo \\"hi\\" && ls')).detail).toBe(
      'echo "hi" && ls',
    );
    expect(describeCall(streamingCall("Bash", '{"comm')).detail).toBe("");
  });

  test("survives a command clipped mid-escape", () => {
    expect(describeCall(streamingCall("Bash", '{"command": "echo one\\')).detail).toBe("echo one");
    expect(describeCall(streamingCall("Bash", '{"command": "echo one\\u00')).detail).toBe(
      "echo one",
    );
  });

  test("names the run a call belongs to", () => {
    expect(describeCall(toolUse("Bash", { command: "ls" }))).toMatchObject({
      label: "Terminal",
      noun: "command",
    });
    expect(describeCall(toolUse("Grep", { pattern: "todo" }))).toMatchObject({
      label: "Explore",
      noun: "search",
    });
    expect(describeCall(toolUse("Read", { file_path: "a.ts" }))).toMatchObject({
      label: "Explore",
      noun: "file",
    });
    expect(describeCall(toolUse("Write", { file_path: "a.ts" }))).toMatchObject({
      label: "Edit",
      noun: "change",
    });
  });

  test("keeps the full command on the detail, unclipped", () => {
    const command = `echo one\n${"x".repeat(80)}`;
    const call = describeCall(toolUse("Bash", { command }));
    expect(call.verb).toBe("Ran");
    expect(call.detail).toBe(`echo one ${"x".repeat(80)}`);
  });

  test("files an unknown tool under its own name", () => {
    expect(describeCall(toolUse("SomeMcpTool", { anything: 1 }))).toMatchObject({
      label: "SomeMcpTool",
      noun: "call",
      detail: "",
    });
  });
});

describe("readFilePath", () => {
  test("a read hands back the whole path, not the name the transcript prints", () => {
    expect(readFilePath(toolUse("Read", { file_path: "apps/web/README.md" }))).toBe(
      "apps/web/README.md",
    );
    expect(readFilePath(toolUse("NotebookRead", { file_path: "notes/run.ipynb" }))).toBe(
      "notes/run.ipynb",
    );
  });

  test("a call that is not a read is not one, however it is spelled", () => {
    expect(readFilePath(toolUse("Write", { file_path: "a.ts" }))).toBeNull();
    expect(readFilePath(toolUse("Bash", { command: "cat a.ts" }))).toBeNull();
    expect(readFilePath(toolUse("SomeMcpTool", { file_path: "a.ts" }))).toBeNull();
  });

  test("a read whose path has not arrived yet resolves to nothing", () => {
    expect(readFilePath(toolUse("Read", {}))).toBeNull();
  });
});
