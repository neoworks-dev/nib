/**
 * Frontmatter is optional and carries no required field: a markdown file is a note
 * because of its extension, never because of what it declares. What is here is
 * whatever the author or the model chose to write, and unknown keys survive.
 *
 * The parser deliberately covers a subset of YAML — scalars, inline lists and
 * block lists. Nested maps are not parsed and are skipped rather than guessed at:
 * the vault format needs no nesting, and a silent misparse is worse than a
 * missing key.
 */

export interface Frontmatter {
  meta: Record<string, string | string[]>;
  /** Everything after the closing fence, unchanged. */
  body: string;
}

const FENCE = "---";

export function parseFrontmatter(source: string): Frontmatter {
  const lines = source.split("\n");
  const opening = lines[0];
  if (opening === undefined || opening.trim() !== FENCE) return { meta: {}, body: source };

  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== undefined && line.trim() === FENCE) {
      closing = index;
      break;
    }
  }
  // An unterminated block is a horizontal rule, not frontmatter.
  if (closing === -1) return { meta: {}, body: source };

  return {
    meta: parseMeta(lines.slice(1, closing)),
    body: lines.slice(closing + 1).join("\n"),
  };
}

/** The last string value for a key, for the common case of a single-valued field. */
export function metaString(meta: Record<string, string | string[]>, key: string): string | null {
  const value = meta[key];
  if (typeof value === "string") return value.length > 0 ? value : null;
  const first = value?.[0];
  if (first === undefined || first.length === 0) return null;
  return first;
}

/**
 * Writes one scalar key back into a file's frontmatter, leaving every other line
 * of it — and the body — exactly as it was. A null value removes the key, and a
 * block left with nothing in it goes with it: a note that was never given a
 * colour should read as a plain note, not as one carrying an empty fence.
 *
 * Line-based rather than a parse-and-serialise round trip, because the parser
 * covers a subset of YAML: rewriting the whole block from what it understood
 * would silently drop anything it skipped.
 */
export function setMetaString(source: string, key: string, value: string | null): string {
  const text = source.replace(/\r\n?/g, "\n");
  const entry = `${key}: ${value ?? ""}`;
  const lines = text.split("\n");
  const closing =
    lines[0]?.trim() === FENCE
      ? lines.findIndex((line, index) => index > 0 && line.trim() === FENCE)
      : -1;

  if (closing === -1) {
    if (value === null) return text;
    return `${FENCE}\n${entry}\n${FENCE}\n${text}`;
  }

  const block = lines.slice(1, closing);
  const at = block.findIndex((line) => keyOf(line) === key);
  if (at === -1) {
    if (value === null) return text;
    block.push(entry);
  } else if (value === null) {
    block.splice(at, 1);
  } else {
    block[at] = entry;
  }

  const rest = lines.slice(closing + 1);
  // An empty block is no block. The body keeps its own opening blank line, so
  // dropping the fence cannot glue the first paragraph onto the line above it.
  if (block.length === 0) return rest.join("\n").replace(/^\n/, "");
  return [FENCE, ...block, FENCE, ...rest].join("\n");
}

/** The key a frontmatter line declares, or null for a list item, comment or blank. */
function keyOf(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("- ")) return null;
  const separator = trimmed.indexOf(":");
  if (separator <= 0) return null;
  return trimmed.slice(0, separator).trim();
}

function parseMeta(lines: readonly string[]): Record<string, string | string[]> {
  const meta: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  let listValues: string[] = [];

  const flush = (): void => {
    if (listKey === null) return;
    const key = listKey;
    const values = listValues;
    listKey = null;
    listValues = [];
    if (values.length === 0) {
      meta[key] = "";
      return;
    }
    meta[key] = values;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    if (line.startsWith("- ")) {
      if (listKey === null) continue;
      listValues.push(unquote(line.slice(2).trim()));
      continue;
    }

    const separator = line.indexOf(":");
    if (separator <= 0) continue;

    flush();
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    if (value.length === 0) {
      listKey = key;
      continue;
    }

    const inline = parseInlineList(value);
    meta[key] = inline ?? unquote(value);
  }

  flush();
  return meta;
}

function parseInlineList(value: string): string[] | null {
  if (!value.startsWith("[")) return null;
  if (!value.endsWith("]")) return null;

  return value
    .slice(1, -1)
    .split(",")
    .map((entry) => unquote(entry.trim()))
    .filter((entry) => entry.length > 0);
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return value;
  if (!value.endsWith(quote)) return value;
  return value.slice(1, -1);
}
