import { describe, expect, test } from "bun:test";
import type { AgentTurn, ToolItem } from "@nib-ui/protocol";
import { toolItem } from "../../../packages/protocol/tests/builders";
import { summarizeChanges } from "../src/changed-files";

/** A tool call that changed files, the way ACP reports it: as diffs in its content. */
function edit(
  id: string,
  changes: Array<{ path: string; oldText: string | null; newText: string }>,
  overrides: Partial<ToolItem> = {},
): ToolItem {
  return toolItem(
    id,
    "Edit",
    {},
    {
      content: changes.map((change) => ({ type: "diff" as const, ...change })),
      ...overrides,
    },
  );
}

function turn(items: AgentTurn["items"]): AgentTurn {
  return { type: "agent", id: "t1", items, completed: true, stopReason: null };
}

describe("summarizeChanges", () => {
  test("counts added and removed lines per file", () => {
    const summary = summarizeChanges(
      turn([edit("b1", [{ path: "src/app.ts", oldText: "a\nb", newText: "a\nc\nd" }])]),
    );

    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]!.path).toBe("src/app.ts");
    expect(summary.added).toBe(2);
    expect(summary.removed).toBe(1);
  });

  test("accumulates repeated edits to one file", () => {
    const summary = summarizeChanges(
      turn([
        edit("b1", [{ path: "a.ts", oldText: "x", newText: "y" }]),
        edit("b2", [{ path: "a.ts", oldText: "p", newText: "q" }]),
      ]),
    );

    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]!.added).toBe(2);
    expect(summary.files[0]!.removed).toBe(2);
  });

  test("treats a new file as pure additions and ignores calls without a diff", () => {
    const summary = summarizeChanges(
      turn([
        edit("b1", [{ path: "new.ts", oldText: null, newText: "one\ntwo" }]),
        toolItem("b2", "Bash", { command: "ls" }),
      ]),
    );

    expect(summary.files.map((file) => file.path)).toEqual(["new.ts"]);
    expect(summary).toMatchObject({ added: 2, removed: 0 });
  });

  test("reads one call that changes several files, whichever harness reported it", () => {
    const summary = summarizeChanges(
      turn([
        edit("b1", [
          { path: "a.ts", oldText: "1", newText: "2" },
          { path: "b.ts", oldText: null, newText: "x" },
        ]),
      ]),
    );

    expect(summary.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
  });

  test("a call that failed changed nothing", () => {
    const summary = summarizeChanges(
      turn([edit("b1", [{ path: "a.ts", oldText: "1", newText: "2" }], { status: "failed" })]),
    );

    expect(summary.files).toEqual([]);
  });
});
