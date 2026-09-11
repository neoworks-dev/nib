import { describe, expect, test } from "bun:test";
import type { BlockView, MessageView } from "@nib-ui/protocol";
import { summarizeChanges } from "../src/changed-files";

function editBlock(id: string, toolName: string, input: Record<string, unknown>): BlockView {
  return {
    id,
    messageId: "m1",
    kind: "tool_use",
    toolName,
    toolUseId: `t-${id}`,
    text: "",
    inputJson: "",
    content: { kind: "tool_use", toolName, toolUseId: `t-${id}`, input },
    completed: true,
  };
}

function message(blocks: BlockView[]): MessageView {
  return { id: "m1", role: "assistant", blocks, completed: true, stopReason: null };
}

describe("summarizeChanges", () => {
  test("counts added and removed lines per file", () => {
    const summary = summarizeChanges(
      message([
        editBlock("b1", "Edit", {
          file_path: "src/app.ts",
          old_string: "a\nb",
          new_string: "a\nc\nd",
        }),
      ]),
    );

    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]!.path).toBe("src/app.ts");
    expect(summary.added).toBe(2);
    expect(summary.removed).toBe(1);
  });

  test("accumulates repeated edits to one file", () => {
    const summary = summarizeChanges(
      message([
        editBlock("b1", "Edit", { file_path: "a.ts", old_string: "x", new_string: "y" }),
        editBlock("b2", "Edit", { file_path: "a.ts", old_string: "p", new_string: "q" }),
      ]),
    );

    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]!.added).toBe(2);
    expect(summary.files[0]!.removed).toBe(2);
  });

  test("treats a Write as pure additions and ignores other tools", () => {
    const summary = summarizeChanges(
      message([
        editBlock("b1", "Write", { file_path: "new.ts", content: "one\ntwo" }),
        editBlock("b2", "Bash", { command: "ls" }),
      ]),
    );

    expect(summary.files.map((file) => file.path)).toEqual(["new.ts"]);
    expect(summary).toMatchObject({ added: 2, removed: 0 });
  });
});
