/**
 * A sheet's markdown as the runs that draw it. The card renders the document
 * rather than showing its source — a heading is a heading, not a line starting
 * with `#` — and the type is small against the card so a paragraph reads as a
 * paragraph at board zoom.
 *
 * Pure: no Pixi, no DOM. What the runs are then baked into is `SheetRenderer`'s
 * business.
 */

import { MONO, SANS, type TextRun } from "./engine/utils/textTexture";
import { type Block, parseBlocks } from "./markdown";
import { type MarkdownTable, tableLines, tableRegions } from "./table";
import { type BoardTheme, SHEET_TYPE } from "./theme";

/**
 * The document as runs, top to bottom.
 *
 * The card's title is drawn only where the markdown does not open with a heading
 * of its own: a note titled in its frontmatter and again in its first line would
 * otherwise say its name twice, and a note with neither is untitled and gets no
 * title line at all.
 */
export function sheetRuns(title: string | null, markdown: string, theme: BoardTheme): TextRun[] {
  const blocks = parseBlocks(markdown);
  const runs: TextRun[] = [];

  const opening = blocks.find((block) => block.text.trim().length > 0);
  const titled = opening?.style === "display" || opening?.style === "headline";
  if (title !== null && !titled)
    runs.push(runFor({ style: "display", text: title, done: false }, theme));

  // A hard wrap in the source is not a line break: prose rewrapped per source
  // line is what makes a card read as a file rather than as a page, so
  // consecutive body lines are one paragraph and a blank line ends it.
  let paragraph: string[] = [];
  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    runs.push(runFor({ style: "body", text: paragraph.join(" "), done: false }, theme));
    paragraph = [];
  };

  // A table is not prose and is not one line either: its rows are found by line
  // and drawn as a block, so the lines they occupy are stepped over here rather
  // than joined into the paragraph around them.
  const tables = new Map<number, MarkdownTable>();
  const covered = new Set<number>();
  for (const region of tableRegions(markdown)) {
    tables.set(region.firstLine, region.table);
    for (let line = region.firstLine; line <= region.lastLine; line += 1) covered.add(line);
  }

  for (const [index, block] of blocks.entries()) {
    const table = tables.get(index);
    if (table) {
      flushParagraph();
      runs.push(tableRun(table, theme));
      continue;
    }
    if (covered.has(index)) continue;

    if (block.style === "body") {
      const text = block.text.trim();
      if (text.length > 0) paragraph.push(text);
      else flushParagraph();
      continue;
    }
    flushParagraph();
    if (block.text.trim().length > 0) runs.push(runFor(block, theme));
  }
  flushParagraph();

  return runs;
}

/**
 * A table, laid out by padding its columns and set in the mono face: a Pixi card
 * draws lines of text and has no grid to build, and columns only line up if
 * every glyph is the same width.
 */
function tableRun(table: MarkdownTable, theme: BoardTheme): TextRun {
  const size = SHEET_TYPE.body - 0.5;
  return {
    text: tableLines(table).join("\n"),
    size,
    color: theme.muted,
    family: MONO,
    pre: true,
    lineHeight: Math.round(size * 1.6),
    gapBefore: 6,
    gapAfter: 9,
  };
}

/** How one markdown level is drawn on a page-sized card. */
function runFor(block: Block, theme: BoardTheme): TextRun {
  const body = SHEET_TYPE.body;
  const bodyLine = Math.round(body * 1.55);

  switch (block.style) {
    case "display":
      return {
        text: block.text,
        size: SHEET_TYPE.display,
        color: theme.text,
        weight: 700,
        family: SANS,
        lineHeight: Math.round(SHEET_TYPE.display * 1.25),
        maxLines: 3,
        gapAfter: 12,
      };
    case "headline":
      return {
        text: block.text,
        size: SHEET_TYPE.headline,
        color: theme.text,
        weight: 700,
        family: SANS,
        lineHeight: Math.round(SHEET_TYPE.headline * 1.35),
        gapBefore: 12,
        gapAfter: 5,
      };
    case "subheader":
      return {
        text: block.text,
        size: SHEET_TYPE.subheader,
        color: theme.text,
        weight: 600,
        family: SANS,
        lineHeight: Math.round(SHEET_TYPE.subheader * 1.4),
        gapBefore: 9,
        gapAfter: 4,
      };
    case "ordered":
      return {
        text: `${block.ordinal ?? 1}.  ${block.text}`,
        size: body,
        color: theme.muted,
        family: SANS,
        lineHeight: bodyLine,
        gapAfter: 2,
      };
    case "list":
      return {
        text: `•  ${block.text}`,
        size: body,
        color: theme.muted,
        family: SANS,
        lineHeight: bodyLine,
        gapAfter: 2,
      };
    case "task":
      return {
        text: `${block.done ? "☑" : "☐"}  ${block.text}`,
        size: body,
        color: block.done ? theme.faint : theme.muted,
        family: SANS,
        lineHeight: bodyLine,
        gapAfter: 2,
      };
    case "body":
      return {
        text: block.text,
        size: body,
        color: theme.muted,
        family: SANS,
        lineHeight: bodyLine,
        gapAfter: 9,
      };
  }
}
