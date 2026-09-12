/**
 * The one block model the board writes through. A sticky card, the inline editor
 * over it and the full-screen sheet editor all read and write these, so what a
 * line means is decided once.
 *
 * It is line-oriented and round-trips: `toMarkdown(parseBlocks(text))` is `text`
 * up to trailing whitespace. That is the whole reason this is not `marked` —
 * a renderer that goes to HTML cannot give an editor a block back to restyle,
 * and the file on disk is the thing being edited (PLAN §2).
 *
 * Pure: no Pixi, no DOM.
 */

/** The rows of the block popover, in the order Spatial lists them. */
export type BlockStyle = "display" | "headline" | "subheader" | "body" | "list" | "task";

export interface Block {
  style: BlockStyle;
  text: string;
  /** A checked task. Meaningless on every other style. */
  done: boolean;
}

export interface BlockStyleRow {
  style: BlockStyle;
  label: string;
  hint: string;
  /**
   * The block already has this style, so picking it would do nothing. Exactly one
   * row of an open popover is disabled, and it is the one naming what the caret
   * is sitting in.
   */
  disabled: boolean;
  /** A rule is drawn above this row, splitting the four styles from the two lists. */
  dividerBefore: boolean;
}

/** Label and shortcut for each row, in the order Spatial lists them. */
const ROWS: { style: BlockStyle; label: string; hint: string }[] = [
  { style: "display", label: "01 Display", hint: "#" },
  { style: "headline", label: "02 Headline", hint: "##" },
  { style: "subheader", label: "03 Subheader", hint: "###" },
  { style: "body", label: "04 Body", hint: "⌘4" },
  { style: "list", label: "List", hint: "⌘L" },
  { style: "task", label: "Task", hint: "⌘T" },
];

/** The popover draws its divider above `List`, splitting the styles from the lists. */
const DIVIDER_BEFORE: BlockStyle = "list";

/**
 * The rows of the block popover for a block in `current`. The whole menu is
 * always shown: a style missing from the list would be a style the user cannot
 * get back to, so the one already in use is greyed rather than dropped.
 */
export function blockStyleRows(current: BlockStyle): BlockStyleRow[] {
  return ROWS.map((row) => ({
    ...row,
    disabled: row.style === current,
    dividerBefore: row.style === DIVIDER_BEFORE,
  }));
}

const PREFIXES: { pattern: RegExp; style: BlockStyle }[] = [
  { pattern: /^-\s+\[( |x|X)\]\s?/, style: "task" },
  { pattern: /^###\s+/, style: "subheader" },
  { pattern: /^##\s+/, style: "headline" },
  { pattern: /^#\s+/, style: "display" },
  { pattern: /^[-*]\s+/, style: "list" },
];

export function parseBlocks(markdown: string): Block[] {
  return markdown.replace(/\r\n?/g, "\n").split("\n").map(parseBlock);
}

export function parseBlock(line: string): Block {
  for (const { pattern, style } of PREFIXES) {
    const match = pattern.exec(line);
    if (!match) continue;
    const done = style === "task" && match[1]?.toLowerCase() === "x";
    return { style, text: line.slice(match[0].length), done };
  }
  return { style: "body", text: line, done: false };
}

export function blockToMarkdown(block: Block): string {
  switch (block.style) {
    case "display":
      return `# ${block.text}`;
    case "headline":
      return `## ${block.text}`;
    case "subheader":
      return `### ${block.text}`;
    case "list":
      return `- ${block.text}`;
    case "task":
      return `- [${block.done ? "x" : " "}] ${block.text}`;
    case "body":
      return block.text;
  }
}

export function toMarkdown(blocks: readonly Block[]): string {
  return blocks.map(blockToMarkdown).join("\n");
}

/**
 * Restyles a block in place, which is what picking a row of the popover does.
 * The text survives the change: the style is how a line is drawn, not what it
 * says, and losing the words on the way from a heading to a task would be a
 * destructive edit dressed up as a formatting one.
 */
export function restyle(block: Block, style: BlockStyle): Block {
  if (style === block.style) return block;
  return { style, text: block.text, done: style === "task" ? block.done : false };
}

export function toggleTask(block: Block): Block {
  if (block.style !== "task") return block;
  return { ...block, done: !block.done };
}

/**
 * What pressing Enter at the end of `block` starts. Spatial continues a list or
 * a task — writing three tasks is three lines, not three menu trips — and drops
 * back to body after a heading, because a document rarely wants two in a row.
 */
export function blockAfter(block: Block): Block {
  if (block.style === "list" || block.style === "task")
    return { style: block.style, text: "", done: false };
  return { style: "body", text: "", done: false };
}

/**
 * Frontmatter, kept apart so an edit writes it back untouched. It is metadata the
 * vault owns — `id:` carries a placement across a rename (PLAN §9) — and an editor
 * that round-tripped it through the block model would rewrite it as body text.
 */
export interface Document {
  frontmatter: string | null;
  blocks: Block[];
}

export function parseDocument(source: string): Document {
  const text = source.replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return { frontmatter: null, blocks: parseBlocks(text) };

  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, blocks: parseBlocks(text) };

  const after = text.indexOf("\n", end + 1);
  const frontmatter = text.slice(0, after === -1 ? text.length : after);
  if (after === -1) return { frontmatter, blocks: [] };
  return { frontmatter, blocks: parseBlocks(text.slice(after + 1)) };
}

export function documentToMarkdown(document: Document): string {
  const body = toMarkdown(document.blocks);
  if (document.frontmatter === null) return body;
  return `${document.frontmatter}\n${body}`;
}
