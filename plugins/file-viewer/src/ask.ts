export interface Selection {
  /** 1-based inclusive line numbers in the file. */
  from: number;
  to: number;
  text: string;
}

const maxSnippetLines = 40;

/** The text of an inclusive 1-based line range, which is the unit the viewer selects in. */
export function sliceLines(text: string, from: number, to: number): string {
  return text
    .split("\n")
    .slice(from - 1, to)
    .join("\n");
}

export function describeRange(selection: Selection): string {
  return selection.from === selection.to
    ? `line ${selection.from}`
    : `lines ${selection.from}–${selection.to}`;
}

/**
 * A question about code the user pointed at. The snippet travels with it so the
 * agent answers about the lines on screen rather than re-reading and guessing,
 * and it is capped because a whole-file selection is a paste, not a citation.
 */
export function selectionPrompt(
  path: string,
  selection: Selection,
  request: string,
): string | null {
  const question = request.trim();
  if (question.length === 0) return null;

  const lines = selection.text.replace(/\s+$/, "").split("\n");
  const snippet =
    lines.length > maxSnippetLines ? [...lines.slice(0, maxSnippetLines), "…"] : lines;

  return [
    `In ${path}, ${describeRange(selection)}:`,
    "",
    "```",
    snippet.join("\n"),
    "```",
    "",
    question,
  ].join("\n");
}
