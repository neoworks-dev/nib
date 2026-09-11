import {
  blockToolInput,
  findToolResultBlock,
  type MessageView,
  type SessionView,
} from "@nib-ui/protocol";

export type Verdict = "accepted" | "rejected";

export interface FileEdit {
  /** The tool call's block id, which is what a verdict is keyed by. */
  id: string;
  path: string;
  before: string;
  after: string;
}

export interface Hunk {
  editId: string;
  /** 0-based index of the first file line the edit produced. */
  startLine: number;
  removed: string[];
  added: string[];
}

export interface ReviewLine {
  kind: "context" | "added" | "removed";
  /** 1-based line number in the file; null on removed lines, which are no longer in it. */
  number: number | null;
  text: string;
  /** Set on the lines a reviewable edit produced or replaced. */
  editId: string | null;
  /** True on the first line of a hunk, which is where its review controls go. */
  startsHunk: boolean;
}

export interface ReviewOutcome {
  editId: string;
  verdict: Verdict;
  /** 1-based inclusive range in the file, or null when the edit could not be located. */
  lines: [number, number] | null;
}

const editTools = new Set(["Edit", "Write", "NotebookEdit"]);

/**
 * The edits from the most recent turn that touched this file. Earlier turns are
 * history the user has already lived with — only the newest change is up for review.
 */
export function latestEdits(session: SessionView, path: string): FileEdit[] {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const edits = editsIn(session, session.messages[index]!, path);
    if (edits.length > 0) return edits;
  }
  return [];
}

function editsIn(session: SessionView, message: MessageView, path: string): FileEdit[] {
  const edits: FileEdit[] = [];
  for (const block of message.blocks) {
    if (block.kind !== "tool_use" || !block.toolName || !editTools.has(block.toolName)) continue;
    const input = (blockToolInput(block) ?? {}) as Record<string, unknown>;
    if (input.file_path !== path) continue;
    // An edit that is still streaming or still running has nothing settled to review.
    if (!block.completed || !findToolResultBlock(session, block.toolUseId)) continue;

    edits.push({
      id: block.id,
      path,
      before: typeof input.old_string === "string" ? input.old_string : "",
      after:
        typeof input.new_string === "string"
          ? input.new_string
          : typeof input.content === "string"
            ? input.content
            : "",
    });
  }
  return edits;
}

/**
 * Locates each edit in the file as it stands now. An edit whose replacement text
 * is no longer present was overwritten since, so it is dropped rather than drawn
 * at a guessed offset; overlapping edits keep the earliest for the same reason.
 */
export function placeHunks(text: string, edits: FileEdit[]): Hunk[] {
  const located: Hunk[] = [];
  for (const edit of edits) {
    if (edit.after.length === 0) continue;
    const at = text.indexOf(edit.after);
    if (at < 0) continue;
    located.push({
      editId: edit.id,
      startLine: text.slice(0, at).split("\n").length - 1,
      removed: edit.before.length > 0 ? edit.before.split("\n") : [],
      added: edit.after.split("\n"),
    });
  }

  const hunks: Hunk[] = [];
  let reached = 0;
  for (const hunk of located.sort((left, right) => left.startLine - right.startLine)) {
    if (hunk.startLine < reached) continue;
    hunks.push(hunk);
    reached = hunk.startLine + hunk.added.length;
  }
  return hunks;
}

/** The file as a diff: context lines as they are, each hunk's removals above its additions. */
export function reviewLines(text: string, hunks: Hunk[]): ReviewLine[] {
  const source = text.split("\n");
  const byStart = new Map(hunks.map((hunk) => [hunk.startLine, hunk]));
  const lines: ReviewLine[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const hunk = byStart.get(index);
    if (!hunk) {
      lines.push({
        kind: "context",
        number: index + 1,
        text: source[index]!,
        editId: null,
        startsHunk: false,
      });
      continue;
    }

    const first = lines.length;
    for (const removed of hunk.removed) {
      lines.push({
        kind: "removed",
        number: null,
        text: removed,
        editId: hunk.editId,
        startsHunk: false,
      });
    }
    for (
      let offset = 0;
      offset < hunk.added.length && index + offset < source.length;
      offset += 1
    ) {
      lines.push({
        kind: "added",
        number: index + offset + 1,
        text: source[index + offset]!,
        editId: hunk.editId,
        startsHunk: false,
      });
    }
    lines[first]!.startsHunk = true;
    index += hunk.added.length - 1;
  }
  return lines;
}

export function hunkRange(hunk: Hunk): [number, number] {
  return [hunk.startLine + 1, hunk.startLine + hunk.added.length];
}

/**
 * What the agent is told once every change to a file has a verdict. Acceptance
 * is the status quo and says nothing; only a rejection is worth a turn, and
 * since the file is deliberately left alone it has to ask for the revert.
 */
export function reviewMessage(path: string, outcomes: ReviewOutcome[]): string | null {
  const rejected = outcomes.filter((outcome) => outcome.verdict === "rejected");
  if (rejected.length === 0) return null;

  const revert = "Revert it and tell me what you would do instead — do not re-apply it.";
  if (rejected.length === outcomes.length) {
    return `I reviewed ${path} in the editor and rejected your change. ${revert}`;
  }

  return [
    `I reviewed ${path} in the editor and rejected the change at ${describe(rejected)}.`,
    `Keep everything else. ${revert}`,
  ].join(" ");
}

function describe(outcomes: ReviewOutcome[]): string {
  const ranges = outcomes.map((outcome) =>
    outcome.lines ? `lines ${outcome.lines[0]}–${outcome.lines[1]}` : "a change I could not locate",
  );
  return ranges.join(", ");
}
