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

/** A new target for a link, or `null` to leave it exactly as it was written. */
export type LinkRename = (target: string) => string | null;

/**
 * Rewrites link targets in place, leaving the alias, the heading and every
 * character outside a `[[…]]` untouched. Code is skipped for the same reason
 * `stripCode` exists: the vault's own guide shows the syntax, and documentation is
 * not a reference.
 */
export function rewriteLinks(body: string, rename: LinkRename): string {
  const lines: string[] = [];
  let fenced = false;

  for (const line of body.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      lines.push(line);
      continue;
    }
    if (fenced) {
      lines.push(line);
      continue;
    }
    lines.push(
      line
        .split(CODE_SPAN)
        .map((part) => (part.startsWith("`") ? part : replaceTargets(part, rename)))
        .join(""),
    );
  }

  return lines.join("\n");
}

/**
 * What a move does to a path-qualified link. A **bare-name** link is never
 * rewritten — the name did not change, which is the entire point of linking by
 * name (PLAN §4) — so only a reference that spells out the old directory moves.
 *
 * `from` and `to` are vault-relative paths of the entry itself, extension and all.
 * A directory carries its contents: `[[old/deep/note]]` follows `old` to `new`.
 */
export function movedLinkTarget(from: string, to: string): LinkRename {
  const fromPath = normalizeTarget(from);
  const toPath = normalizeTarget(to);
  const fromStem = withoutExtension(fromPath);
  const toStem = withoutExtension(toPath);

  return (target: string): string | null => {
    const reference = normalizeTarget(target);
    // A reference with no directory in it is a name, and the name did not change.
    // This is the whole reason a move is survivable at all (PLAN §4).
    if (!reference.includes("/")) return null;
    if (reference === fromStem) return toStem;
    if (reference === fromPath) return toPath;
    if (reference.startsWith(`${fromPath}/`)) return `${toPath}${reference.slice(fromPath.length)}`;
    return null;
  };
}

/**
 * What a rename does to links. Unlike a move, the name itself changed, so a
 * **bare-name** reference to the entry is rewritten as well as a path-qualified
 * one: `[[old]]` becomes `[[new]]`, written with or without its extension the
 * way it was. A bare name another entry of the same name also answers to is
 * rewritten too — names are how the vault links, and the rename is of that name.
 *
 * `from` and `to` are vault-relative paths of the entry itself, extension and all.
 */
export function renamedLinkTarget(from: string, to: string): LinkRename {
  const moved = movedLinkTarget(from, to);
  const fromName = baseOf(normalizeTarget(from));
  const toName = baseOf(normalizeTarget(to));
  const fromStem = withoutExtension(fromName);
  const toStem = withoutExtension(toName);

  return (target: string): string | null => {
    const reference = normalizeTarget(target);
    if (reference.includes("/")) return moved(target);
    if (reference === fromName) return toName;
    if (reference === fromStem) return toStem;
    return null;
  };
}

/** The last segment of a vault path. */
function baseOf(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return path;
  return path.slice(slash + 1);
}

const CODE_SPAN = /(`[^`]*`)/g;

function replaceTargets(text: string, rename: LinkRename): string {
  return text.replace(LINK, (whole: string, inner: string) => {
    // `[[target#heading|alias]]`: the target is the head, and everything from the
    // first `#` or `|` onward is carried through untouched. Slicing at the index
    // rather than branching keeps an absent part an empty slice of its own.
    const bar = inner.indexOf("|");
    const barAt = bar === -1 ? inner.length : bar;
    const targetPart = inner.slice(0, barAt);
    const suffix = inner.slice(barAt);

    const hash = targetPart.indexOf("#");
    const hashAt = hash === -1 ? targetPart.length : hash;
    const head = targetPart.slice(0, hashAt);
    const anchor = targetPart.slice(hashAt);

    const next = rename(head.trim());
    if (next === null) return whole;
    return `[[${next}${anchor}${suffix}]]`;
  });
}

function normalizeTarget(target: string): string {
  let key = target.trim().replace(/^\.\//, "");
  if (key.endsWith("/")) key = key.slice(0, -1);
  return key;
}

function withoutExtension(path: string): string {
  const slash = path.lastIndexOf("/");
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return path;
  return path.slice(0, path.length - (base.length - dot));
}
