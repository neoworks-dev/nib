import { describe, expect, test } from "bun:test";
import type { ToolItem } from "@nib-ui/protocol";
import { sessionOf, toolItem, userItem } from "../../../packages/protocol/tests/builders";
import {
  type FileEdit,
  hunkRange,
  latestEdits,
  placeHunks,
  type ReviewOutcome,
  reviewLines,
  reviewMessage,
} from "../src/changes";

/** A file edit the way ACP reports it: a tool call whose content is a diff. */
function edit(
  id: string,
  path: string,
  oldText: string | null,
  newText: string,
  overrides: Partial<ToolItem> = {},
): ToolItem {
  return toolItem(
    id,
    "Edit",
    {},
    {
      content: [{ type: "diff", path, oldText, newText }],
      ...overrides,
    },
  );
}

describe("latestEdits", () => {
  test("reads applied edits for the file", () => {
    const view = sessionOf("s1", [userItem("u1", "go"), edit("b1", "/repo/a.ts", "one", "ONE")]);
    expect(latestEdits(view, "/repo/a.ts")).toEqual([
      { id: "b1", path: "/repo/a.ts", before: "one", after: "ONE" },
    ]);
  });

  test("takes the whole content of a new file as the change", () => {
    const view = sessionOf("s1", [edit("b1", "/repo/a.ts", null, "new file")]);
    expect(latestEdits(view, "/repo/a.ts")[0]).toEqual({
      id: "b1",
      path: "/repo/a.ts",
      before: "",
      after: "new file",
    });
  });

  test("only the newest turn that touched the file is reviewable", () => {
    const view = sessionOf("s1", [
      userItem("u1", "first"),
      edit("b1", "/repo/a.ts", null, "first"),
      userItem("u2", "second"),
      edit("b2", "/repo/b.ts", null, "other"),
      userItem("u3", "third"),
      edit("b3", "/repo/a.ts", null, "second"),
    ]);
    expect(latestEdits(view, "/repo/a.ts").map((entry) => entry.id)).toEqual(["b3"]);
  });

  test("ignores edits to other files and calls that have not finished", () => {
    const view = sessionOf("s1", [
      userItem("u1", "go"),
      edit("b1", "/repo/other.ts", null, "x"),
      edit("b2", "/repo/a.ts", null, "pending", { status: "in_progress" }),
    ]);
    expect(latestEdits(view, "/repo/a.ts")).toEqual([]);
  });

  test("keeps every file of a call that changes several, each under its own id", () => {
    const view = sessionOf("s1", [
      toolItem(
        "b1",
        "apply_patch",
        {},
        {
          content: [
            { type: "diff", path: "/repo/a.ts", oldText: "1", newText: "2" },
            { type: "diff", path: "/repo/a.ts", oldText: "3", newText: "4" },
          ],
        },
      ),
    ]);
    expect(latestEdits(view, "/repo/a.ts").map((entry) => entry.id)).toEqual(["b1", "b1:1"]);
  });
});

const text = ["alpha", "beta", "gamma", "delta"].join("\n");

describe("placeHunks", () => {
  test("locates an edit by its replacement text", () => {
    const edits: FileEdit[] = [{ id: "b1", path: "a", before: "BETA", after: "beta" }];
    expect(placeHunks(text, edits)).toEqual([
      { editId: "b1", startLine: 1, removed: ["BETA"], added: ["beta"] },
    ]);
  });

  test("drops an edit whose replacement was overwritten since", () => {
    expect(
      placeHunks(text, [{ id: "b1", path: "a", before: "x", after: "not in the file" }]),
    ).toEqual([]);
  });

  test("keeps the earlier of two overlapping edits", () => {
    const edits: FileEdit[] = [
      { id: "b2", path: "a", before: "", after: "gamma" },
      { id: "b1", path: "a", before: "", after: "beta\ngamma" },
    ];
    expect(placeHunks(text, edits).map((hunk) => hunk.editId)).toEqual(["b1"]);
  });

  test("reports the range a hunk covers", () => {
    const [hunk] = placeHunks(text, [{ id: "b1", path: "a", before: "", after: "beta\ngamma" }]);
    expect(hunkRange(hunk!)).toEqual([2, 3]);
  });
});

describe("reviewLines", () => {
  test("puts removals above additions and numbers only real lines", () => {
    const hunks = placeHunks(text, [{ id: "b1", path: "a", before: "BETA", after: "beta" }]);
    expect(reviewLines(text, hunks)).toEqual([
      { kind: "context", number: 1, text: "alpha", editId: null, startsHunk: false },
      { kind: "removed", number: null, text: "BETA", editId: "b1", startsHunk: true },
      { kind: "added", number: 2, text: "beta", editId: "b1", startsHunk: false },
      { kind: "context", number: 3, text: "gamma", editId: null, startsHunk: false },
      { kind: "context", number: 4, text: "delta", editId: null, startsHunk: false },
    ]);
  });

  test("an insertion with nothing removed starts the hunk on its first added line", () => {
    const hunks = placeHunks(text, [{ id: "b1", path: "a", before: "", after: "beta\ngamma" }]);
    const lines = reviewLines(text, hunks);
    expect(lines.filter((line) => line.startsHunk)).toEqual([
      { kind: "added", number: 2, text: "beta", editId: "b1", startsHunk: true },
    ]);
    expect(lines.map((line) => line.kind)).toEqual(["context", "added", "added", "context"]);
  });

  test("a file with no hunks is all context", () => {
    expect(reviewLines(text, []).every((line) => line.kind === "context")).toBe(true);
  });
});

describe("reviewMessage", () => {
  const accepted: ReviewOutcome = { editId: "b1", verdict: "accepted", lines: [2, 3] };
  const rejected: ReviewOutcome = { editId: "b2", verdict: "rejected", lines: [8, 9] };

  test("says nothing when everything was accepted", () => {
    expect(reviewMessage("/repo/a.ts", [accepted])).toBeNull();
  });

  test("asks for a revert when everything was rejected", () => {
    expect(reviewMessage("/repo/a.ts", [rejected])).toBe(
      "I reviewed /repo/a.ts in the editor and rejected your change. Revert it and tell me what you would do instead — do not re-apply it.",
    );
  });

  test("names the rejected range when only part was rejected", () => {
    const message = reviewMessage("/repo/a.ts", [accepted, rejected]);
    expect(message).toContain("rejected the change at lines 8–9");
    expect(message).toContain("Keep everything else");
  });
});
