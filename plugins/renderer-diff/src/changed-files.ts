import { type AgentTurn, toolDiffs } from "@nib-ui/protocol";
import { diffLines } from "./diff";

export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
}

export interface ChangeSummary {
  files: ChangedFile[];
  added: number;
  removed: number;
}

/**
 * The files a turn changed, read from the ACP diffs its tool calls carry. One
 * entry per file: repeated edits to the same path accumulate, and a call that
 * failed changed nothing.
 */
export function summarizeChanges(turn: AgentTurn): ChangeSummary {
  const byPath = new Map<string, ChangedFile>();

  for (const item of turn.items) {
    if (item.type !== "tool" || item.status === "failed") continue;
    for (const diff of toolDiffs(item)) {
      const lines = diffLines(diff.oldText ?? "", diff.newText);
      const entry = byPath.get(diff.path) ?? { path: diff.path, added: 0, removed: 0 };
      entry.added += lines.filter((line) => line.kind === "added").length;
      entry.removed += lines.filter((line) => line.kind === "removed").length;
      byPath.set(diff.path, entry);
    }
  }

  const files = [...byPath.values()];
  return {
    files,
    added: files.reduce((total, file) => total + file.added, 0),
    removed: files.reduce((total, file) => total + file.removed, 0),
  };
}
