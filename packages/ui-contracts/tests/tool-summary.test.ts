import { describe, expect, test } from "bun:test";
import type { ToolItem } from "@nib-ui/protocol";
import { toolItem } from "../../protocol/tests/builders";
import {
  describeCall,
  describeStep,
  parseMcpToolName,
  readFilePath,
  toolDisplayName,
} from "../src/tool-summary";

function toolUse(toolName: string, input: unknown, overrides: Partial<ToolItem> = {}): ToolItem {
  return toolItem(`${toolName}-1`, toolName, input, overrides);
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

describe("describeCall", () => {
  test("reads the command from the call's input", () => {
    expect(describeCall(toolUse("Bash", { command: "git status --porcelain" })).detail).toBe(
      "git status --porcelain",
    );
  });

  test("a command whose input has not arrived reads as the title the harness gave it", () => {
    expect(describeCall(toolUse("Bash", {}, { title: "echo hello" })).detail).toBe("echo hello");
  });

  test("tells every harness's tools apart by ACP kind, whatever they are called", () => {
    expect(describeCall(toolUse("bash", { command: "ls" }))).toMatchObject({
      label: "Terminal",
      verb: "Ran",
      detail: "ls",
    });
    expect(describeCall(toolUse("read", { path: "src/a.ts" }))).toMatchObject({
      label: "Explore",
      verb: "Read",
      detail: "a.ts",
    });
    expect(describeCall(toolUse("edit", { path: "src/a.ts" }))).toMatchObject({
      label: "Edit",
      verb: "Updated",
      detail: "a.ts",
    });
    expect(
      describeCall(
        toolUse(
          "apply_patch",
          {},
          {
            kind: "edit",
            content: [{ type: "diff", path: "/r/b.ts", oldText: null, newText: "x" }],
          },
        ),
      ),
    ).toMatchObject({ label: "Edit", detail: "b.ts" });
  });

  test("takes the file of an edit from its diff or its location when the input names none", () => {
    expect(
      describeCall(toolUse("X", {}, { kind: "read", locations: [{ path: "/r/c.ts" }] })).subject,
    ).toBe("/r/c.ts");
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

  test("an unknown tool still says what it was handed", () => {
    expect(describeCall(toolUse("SomeMcpTool", { count: 2, query: "widgets" })).detail).toBe(
      "widgets",
    );
  });

  test("an MCP call files under its server and names its own tool", () => {
    expect(describeCall(toolUse("mcp__acme__fetch_invoice", { invoiceId: "inv-9" }))).toMatchObject(
      {
        label: "Acme",
        noun: "call",
        verb: "Fetch invoice",
        detail: "inv-9",
      },
    );
  });

  test("the agent tools read the same whether a harness ran them over MCP or in process", () => {
    const overMcp = describeCall(
      toolUse("mcp__nib__send_to_agent", { sessionId: "a1", text: "go" }),
    );
    const inProcess = describeCall(toolUse("send_to_agent", { sessionId: "a1", text: "go" }));
    expect(overMcp).toMatchObject({ label: "Agents", noun: "message", verb: "Sent", detail: "go" });
    expect(inProcess).toEqual(overMcp);
  });

  test("every agent tool belongs to the same run", () => {
    const labels = [
      "mcp__nib__spawn_agent",
      "mcp__nib__read_agent",
      "mcp__nib__stop_agent",
      "mcp__nib__list_agents",
      "mcp__nib__list_harnesses",
      "Task",
    ].map((toolName) => describeCall(toolUse(toolName, { sessionId: "a1" })).label);
    expect(labels).toEqual(["Agents", "Agents", "Agents", "Agents", "Agents", "Agents"]);
  });
});

describe("parseMcpToolName", () => {
  test("splits a server off its tool, and leaves a built-in alone", () => {
    expect(parseMcpToolName("mcp__nib__send_to_agent")).toEqual({
      server: "nib",
      tool: "send_to_agent",
    });
    expect(parseMcpToolName("Bash")).toBeNull();
    expect(parseMcpToolName("mcp__nib")).toBeNull();
  });
});

describe("toolDisplayName", () => {
  test("an MCP tool loses its transport; anything else keeps its name", () => {
    expect(toolDisplayName("mcp__nib__send_to_agent")).toBe("Send to agent");
    expect(toolDisplayName("mcp__acme__readFile")).toBe("Read file");
    expect(toolDisplayName("Bash")).toBe("Bash");
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
