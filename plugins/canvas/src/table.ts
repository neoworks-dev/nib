/**
 * GFM pipe tables, read once for everything that draws one: the note editor's
 * live preview builds a real `<table>` from this, and a sheet card lays the same
 * table out as monospaced text because a Pixi card has no table to build.
 *
 * Pure: no Pixi, no DOM. It is line-oriented like `markdown.ts`, and for the same
 * reason — the file is what is being edited, so a table has to be findable by the
 * lines it occupies.
 */

export type ColumnAlign = "left" | "center" | "right";

export interface MarkdownTable {
  header: string[];
  /** One per column, in the order the header names them. */
  align: ColumnAlign[];
  rows: string[][];
}

/** Where a table sits in a document: line numbers, zero-based and inclusive. */
export interface TableRegion {
  firstLine: number;
  lastLine: number;
  table: MarkdownTable;
}

/**
 * A cell may contain an escaped pipe, which is not a column break. Swapping it
 * for something no keyboard produces is what lets the row split on `|` alone.
 */
const ESCAPED_PIPE = "\uE000";

/** `---`, `:--`, `--:` or `:-:`, which is the row that makes a table a table. */
const DELIMITER_CELL = /^:?-+:?$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .replaceAll("\\|", ESCAPED_PIPE)
    .split("|")
    .map((cell) => cell.replaceAll(ESCAPED_PIPE, "|").trim());
}

function alignOf(cell: string): ColumnAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

/** Whether this line can only be the delimiter row of a table. */
function isDelimiterRow(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
}

/**
 * The table these lines are, or null for lines that are not one. A table is its
 * header, the delimiter row under it and every row after that still carrying a
 * pipe: the first line that does not is where the table ends.
 *
 * Rows are squared off against the header, which is what GFM does — a short row
 * gets empty cells and a long one loses the overflow — so a renderer can walk
 * the grid without measuring every row.
 */
export function parseTable(source: string): MarkdownTable | null {
  return tableAt(source.replace(/\r\n?/g, "\n").split("\n"), 0)?.table ?? null;
}

/**
 * The table starting on this line, and the line it ends on. Null where the line
 * does not open one.
 */
export function tableAt(lines: readonly string[], firstLine: number): TableRegion | null {
  const header = lines[firstLine];
  const delimiter = lines[firstLine + 1];
  if (header === undefined || delimiter === undefined) return null;
  if (!header.includes("|") || isDelimiterRow(header)) return null;
  if (!isDelimiterRow(delimiter)) return null;

  const names = splitRow(header);
  const align = splitRow(delimiter).map(alignOf);
  // GFM requires the two to agree; a delimiter row of another width is a line of
  // dashes under a line of text, which is not a table and should stay prose.
  if (align.length !== names.length) return null;

  const rows: string[][] = [];
  let lastLine = firstLine + 1;
  for (let line = firstLine + 2; line < lines.length; line += 1) {
    const row = lines[line];
    if (row === undefined || !row.includes("|")) break;
    rows.push(squared(splitRow(row), names.length));
    lastLine = line;
  }

  return { firstLine, lastLine, table: { header: names, align, rows } };
}

function squared(cells: string[], width: number): string[] {
  if (cells.length === width) return cells;
  if (cells.length > width) return cells.slice(0, width);
  return [...cells, ...Array.from({ length: width - cells.length }, () => "")];
}

/** Every table in the document, in the order they are written. */
export function tableRegions(markdown: string): TableRegion[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const regions: TableRegion[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    const region = tableAt(lines, line);
    if (!region) continue;
    regions.push(region);
    line = region.lastLine;
  }
  return regions;
}

/**
 * The table back as markdown, which is what a grid edited in place writes to the
 * file. Columns are padded to their widest cell: the file is what is being
 * edited and is read by people, and a table whose pipes line up is one a text
 * editor can still be used on.
 */
export function tableMarkdown(table: MarkdownTable): string {
  const widths = table.header.map((name, column) =>
    table.rows.reduce(
      (widest, row) => Math.max(widest, escapeCell(row[column] ?? "").length),
      Math.max(escapeCell(name).length, 3),
    ),
  );
  const row = (cells: readonly string[]): string =>
    `| ${cells.map((text, column) => escapeCell(text).padEnd(widths[column] ?? 0)).join(" | ")} |`;

  const delimiters = widths.map((width, column) => {
    const align = table.align[column];
    if (align === "center") return `:${"-".repeat(Math.max(1, width - 2))}:`;
    if (align === "right") return `${"-".repeat(Math.max(1, width - 1))}:`;
    return "-".repeat(width);
  });

  return [
    row(table.header),
    `| ${delimiters.join(" | ")} |`,
    ...table.rows.map((cells) => row(cells)),
  ].join("\n");
}

/** A cell is one line of one column, whatever was typed into it. */
function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

/**
 * The table as the lines a monospaced renderer draws, columns padded to their
 * widest cell. What a card without a table to build shows: the grid still reads
 * as a grid because every glyph is the same width.
 */
export function tableLines(table: MarkdownTable): string[] {
  const widths = table.header.map((name, column) =>
    table.rows.reduce((widest, row) => Math.max(widest, row[column]?.length ?? 0), name.length),
  );
  const rule = widths.map((width) => "─".repeat(width));
  const cell = (text: string, column: number): string => {
    const width = widths[column] ?? text.length;
    if (table.align[column] === "right") return text.padStart(width);
    if (table.align[column] !== "center") return text.padEnd(width);
    const left = Math.floor((width - text.length) / 2);
    return `${" ".repeat(left)}${text}`.padEnd(width);
  };
  const line = (cells: readonly string[]): string =>
    cells.map((text, column) => cell(text, column)).join("  ");

  return [line(table.header), line(rule), ...table.rows.map(line)];
}
