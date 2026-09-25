/**
 * The block model a card draws through. A sticky or sheet card reads its body
 * as these, and ticking a task from a card writes one back, so what a line
 * means on the board is decided once. The editor itself is `MarkdownEditor`,
 * which works on the text and leaves the drawing to `live-preview`.
 *
 * It is line-oriented and round-trips: `toMarkdown(parseBlocks(text))` is `text`
 * up to trailing whitespace. That is the whole reason this is not `marked` —
 * a renderer that goes to HTML cannot give a card a block back to tick,
 * and the file on disk is the thing being edited (PLAN §2).
 *
 * Pure: no Pixi, no DOM.
 */

export type BlockStyle =
  "display" | "headline" | "subheader" | "body" | "list" | "ordered" | "task";

export interface Block {
  style: BlockStyle;
  text: string;
  /** A checked task. Meaningless on every other style. */
  done: boolean;
  /** The number an ordered item was written with, so `3.` stays `3.` on the way back. */
  ordinal?: number;
}

const PREFIXES: { pattern: RegExp; style: BlockStyle }[] = [
  { pattern: /^-\s+\[( |x|X)\]\s?/, style: "task" },
  { pattern: /^###\s+/, style: "subheader" },
  { pattern: /^##\s+/, style: "headline" },
  { pattern: /^#\s+/, style: "display" },
  { pattern: /^[-*]\s+/, style: "list" },
  { pattern: /^(\d+)\.\s+/, style: "ordered" },
];

export function parseBlocks(markdown: string): Block[] {
  return markdown.replace(/\r\n?/g, "\n").split("\n").map(parseBlock);
}

export function parseBlock(line: string): Block {
  for (const { pattern, style } of PREFIXES) {
    const match = pattern.exec(line);
    if (!match) continue;
    const done = style === "task" && match[1]?.toLowerCase() === "x";
    const text = line.slice(match[0].length);
    if (style !== "ordered") return { style, text, done };
    return { style, text, done, ordinal: Number(match[1]) };
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
    case "ordered":
      return `${block.ordinal ?? 1}. ${block.text}`;
    case "task":
      return `- [${block.done ? "x" : " "}] ${block.text}`;
    case "body":
      return block.text;
  }
}

/**
 * A run of a line that is drawn differently from the rest of it. The card draws
 * these; the editor draws the same emphasis from CodeMirror's own tree, so this
 * is only ever asked about text that is not being edited.
 */
export interface InlineSpan {
  text: string;
  strong?: boolean;
  em?: boolean;
  strike?: boolean;
  code?: boolean;
  /**
   * The name a `[[link]]` points at, with any alias and heading taken off — the
   * same target the vault's own scan recorded, so a card can ask where it lands.
   */
  link?: string;
}

/**
 * `**strong**`, `*em*`, `_em_`, `~~struck~~` and `` `code` ``, with the markers
 * taken off. One level of nesting is carried through — `**a ~~b~~**` is strong
 * throughout and struck in the middle — and anything unbalanced is left as the
 * text it is, which is what a lone asterisk in prose should stay.
 *
 * Code is not looked into: backticks are what says "read this literally", so a
 * `*` inside them is an asterisk rather than emphasis.
 */
export function parseInline(text: string): InlineSpan[] {
  const pattern =
    /\[\[([^[\]]+)\]\]|`([^`\n]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
  const spans: InlineSpan[] = [];
  let plainFrom = 0;

  // The inner text is parsed again so a mark inside another one keeps both.
  const marked = (inner: string, mark: Omit<InlineSpan, "text">): void => {
    for (const span of parseInline(inner)) spans.push({ ...span, ...mark });
  };

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > plainFrom) spans.push({ text: text.slice(plainFrom, match.index) });
    plainFrom = match.index + match[0].length;

    const [, wikilink, code, strong, strike, star, underscore] = match;
    if (wikilink !== undefined) spans.push(linkSpan(wikilink));
    else if (code !== undefined) spans.push({ text: code, code: true });
    else if (strong !== undefined) marked(strong, { strong: true });
    else if (strike !== undefined) marked(strike, { strike: true });
    else if (star !== undefined) marked(star, { em: true });
    else if (underscore !== undefined) marked(underscore, { em: true });
  }

  if (plainFrom < text.length) spans.push({ text: text.slice(plainFrom) });
  return spans;
}

/**
 * `[[target|alias]]` and `[[target#heading]]`, read the way the vault's own scan
 * reads them: the card shows the alias where there is one and the name where
 * there is not, and points at the target either way.
 */
function linkSpan(inner: string): InlineSpan {
  const bar = inner.indexOf("|");
  const named = bar === -1 ? inner : inner.slice(0, bar);
  const hash = named.indexOf("#");
  const target = (hash === -1 ? named : named.slice(0, hash)).trim();
  if (bar === -1) return { text: target, link: target };

  const alias = inner.slice(bar + 1).trim();
  if (alias.length === 0) return { text: target, link: target };
  return { text: alias, link: target };
}

export function toMarkdown(blocks: readonly Block[]): string {
  return blocks.map(blockToMarkdown).join("\n");
}

export function toggleTask(block: Block): Block {
  if (block.style !== "task") return block;
  return { ...block, done: !block.done };
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

/**
 * Splits frontmatter off the body. The body is returned as the text it is, so
 * an editor can work on it without a block model in between.
 */
export function splitFrontmatter(source: string): { frontmatter: string | null; body: string } {
  const text = source.replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return { frontmatter: null, body: text };

  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, body: text };

  const after = text.indexOf("\n", end + 1);
  if (after === -1) return { frontmatter: text, body: "" };
  return { frontmatter: text.slice(0, after), body: text.slice(after + 1) };
}

export function parseDocument(source: string): Document {
  const { frontmatter, body } = splitFrontmatter(source);
  return { frontmatter, blocks: parseBlocks(body) };
}

export function documentToMarkdown(document: Document): string {
  const body = toMarkdown(document.blocks);
  if (document.frontmatter === null) return body;
  return `${document.frontmatter}\n${body}`;
}
