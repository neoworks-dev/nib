/**
 * A sticky's markdown as the lines that draw it. A note on a square of paper is
 * short and structured — a heading, a few bullets, a couple of tasks — so the
 * card draws what the markdown means rather than the characters that say it:
 * `## Snapping` is a heading, `- [ ]` is a box, `**bold**` is bold.
 *
 * Line-oriented rather than flowed like a sheet: every line here keeps the
 * number of the file line it came from, which is what lets a press on a checkbox
 * be written back to the right line of the file.
 *
 * Pure: no Pixi, no DOM. `StickyRenderer` bakes these.
 */

import {
  MONO,
  SANS,
  type TextRun,
  type TextSegment,
  lineHeightOf,
  segmentedRun,
} from "./engine/utils/textTexture";
import { type Block, type InlineSpan, parseBlocks, parseInline } from "./markdown";
import { STICKY_INK } from "./theme";

/** What is drawn in the gutter beside a line, out in the card's left margin. */
export type StickyGutter =
  { kind: "task"; done: boolean } | { kind: "bullet" } | { kind: "number"; label: string };

export interface StickyLine {
  /** The line's number in the file, so a tick reaches the line it was drawn from. */
  line: number;
  run: TextRun;
  gutter: StickyGutter | null;
  /** World units the text is pushed in by, to clear the gutter. */
  indent: number;
  /** Space above the line — what separates a heading from the block before it. */
  gapBefore: number;
}

/** World units: the box, the gap to the words beside it, and the grab margin. */
export const CHECKBOX_SIZE = 12;
export const CHECKBOX_GAP = 9;
export const CHECKBOX_REACH = 5;

/** A sticky's own type scale. Smaller steps than a sheet: there is less room. */
export const STICKY_TYPE = {
  display: 21,
  headline: 17,
  subheader: 15,
  body: 13.5,
} as const;

/**
 * The body as drawn lines, blank ones dropped. The note's own title is not here:
 * the card draws it from `title`, and `board-view` has already taken that heading
 * off the body so it cannot be printed twice.
 */
export function stickyLines(markdown: string): StickyLine[] {
  const lines: StickyLine[] = [];
  let blanks = 0;

  for (const [line, block] of parseBlocks(markdown).entries()) {
    // A blank line is the space between two paragraphs, and the editor keeps it
    // as a line of its own: the card holds that space rather than closing it up,
    // or the note reads differently on the card than it does under the caret.
    if (block.text.trim().length === 0) {
      blanks += 1;
      continue;
    }
    const gutter = gutterFor(block);
    const run = runFor(block);
    lines.push({
      line,
      run,
      gutter,
      indent: gutter === null ? 0 : CHECKBOX_SIZE + CHECKBOX_GAP,
      gapBefore: lines.length === 0 ? 0 : blanks * lineHeightOf(run),
    });
    blanks = 0;
  }
  return lines;
}

/** The card's own headline, or null for a note that has not named itself. */
export function stickyTitleRun(title: string): TextRun {
  return {
    text: title,
    size: STICKY_TYPE.display,
    color: STICKY_INK.text,
    weight: 700,
    family: SANS,
    lineHeight: Math.round(STICKY_TYPE.display * 1.22),
    maxLines: 3,
  };
}

function runFor(block: Block): TextRun {
  const segments = parseInline(block.text).map(segmentFor);

  const base = {
    size: STICKY_TYPE.body,
    color: block.done ? STICKY_INK.faint : STICKY_INK.muted,
    family: SANS,
    lineHeight: Math.round(STICKY_TYPE.body * 1.5),
  };

  switch (block.style) {
    case "display":
      return segmentedRun({ ...base, ...headingType(STICKY_TYPE.display, 700) }, segments);
    case "headline":
      return segmentedRun({ ...base, ...headingType(STICKY_TYPE.headline, 700) }, segments);
    case "subheader":
      return segmentedRun({ ...base, ...headingType(STICKY_TYPE.subheader, 600) }, segments);
    default:
      return segmentedRun(base, segments);
  }
}

function headingType(size: number, weight: number): Partial<TextRun> {
  return { size, weight, color: STICKY_INK.text, lineHeight: Math.round(size * 1.3) };
}

/** One stretch of a line, in whatever the emphasis around it asks for. */
function segmentFor(span: InlineSpan): TextSegment {
  const segment: TextSegment = { text: span.text };
  if (span.strong === true) segment.weight = 700;
  if (span.em === true) segment.italic = true;
  if (span.strike === true) segment.strike = true;
  // An identifier in a note is read as code, so it is set as code — the editor
  // draws the same span in the same face.
  if (span.code === true) segment.family = MONO;
  if (span.link !== undefined) {
    segment.link = span.link;
    segment.color = STICKY_INK.link;
  }
  return segment;
}

function gutterFor(block: Block): StickyGutter | null {
  if (block.style === "task") return { kind: "task", done: block.done };
  if (block.style === "list") return { kind: "bullet" };
  if (block.style === "ordered") return { kind: "number", label: `${block.ordinal ?? 1}.` };
  return null;
}
