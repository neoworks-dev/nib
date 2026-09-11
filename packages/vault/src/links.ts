/**
 * `[[name]]` is the only link syntax. A target is a name — a file's stem or a
 * directory's basename — never a path, which is what lets the vault be
 * reorganized without rewriting every reference.
 */

export interface RawLink {
  target: string;
  alias: string | null;
}

const FENCE = /^ {0,3}(?:```|~~~)/;
const INLINE_CODE = /`[^`]*`/g;
const LINK = /\[\[([^[\]]+)\]\]/g;

/**
 * Blanks out fenced blocks and inline code spans, keeping line structure. The
 * vault's own instructions show `[[name]]` as an example, and documentation is
 * not a reference — without this the manual links to every name it mentions.
 */
export function stripCode(source: string): string {
  const lines: string[] = [];
  let fenced = false;

  for (const line of source.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      lines.push("");
      continue;
    }
    if (fenced) {
      lines.push("");
      continue;
    }
    lines.push(line.replace(INLINE_CODE, " "));
  }

  return lines.join("\n");
}

export function extractLinks(body: string): RawLink[] {
  const text = stripCode(body);
  const links: RawLink[] = [];

  for (const match of text.matchAll(LINK)) {
    const inner = match[1];
    if (inner === undefined) continue;
    const link = parseLink(inner);
    if (link) links.push(link);
  }

  return links;
}

/** `[[target|alias]]` and `[[target#heading]]`, either or both. */
function parseLink(inner: string): RawLink | null {
  const bar = inner.indexOf("|");
  const targetPart = bar === -1 ? inner : inner.slice(0, bar);
  const aliasPart = bar === -1 ? null : inner.slice(bar + 1);

  const hash = targetPart.indexOf("#");
  const target = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim();
  if (target.length === 0) return null;

  const alias = aliasPart?.trim() ?? "";
  return { target, alias: alias.length > 0 ? alias : null };
}
