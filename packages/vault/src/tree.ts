/**
 * The vault as the rest of the app reads it. Pure: everything here is a function
 * of a listing plus the markdown bodies, so the whole model is testable without a
 * filesystem, and the same derivations can run on the client.
 *
 * There is no schema and no required field. A directory is a topic, a file is an
 * item, and both are linkable by name. Nothing carries special meaning.
 */

import { metaString, parseFrontmatter } from "./frontmatter";
import { extractLinks, stripCode, type RawLink } from "./links";

export type VaultEntryKind = "file" | "topic";

export interface VaultEntry {
  /** Vault-relative POSIX path. */
  path: string;
  kind: VaultEntryKind;
}

export interface VaultItem extends VaultEntry {
  /** The directory holding it, `""` at the vault root. */
  dir: string;
  /** Linkable name: a file's stem, or a directory's basename. */
  name: string;
  meta: Record<string, string | string[]>;
  id: string | null;
  title: string | null;
  /** The colour the item asked for, as the name it wrote; the board owns the palette. */
  color: string | null;
  links: RawLink[];
  /** The body with code spans and fences blanked, for mention scanning. */
  text: string;
}

/** One link as it was written, and where it landed. */
export interface VaultLink {
  from: string;
  target: string;
  /** `null` when nothing in the vault answers to that name. */
  to: string | null;
  /** More than one item answers to the name; the closest to `from` was chosen. */
  ambiguous: boolean;
}

export interface VaultMention {
  source: string;
  target: string;
  count: number;
}

export interface VaultIndex {
  items: VaultItem[];
  byPath: Map<string, VaultItem>;
  /** Candidates per bare name, in path order. */
  byName: Map<string, VaultItem[]>;
  /** Candidates per vault-relative path without its extension. */
  byReference: Map<string, VaultItem[]>;
  links: VaultLink[];
  /** Target path to the paths that link to it, in path order, deduplicated. */
  backlinks: Map<string, string[]>;
  /** Names a link asked for that nothing answers to. */
  unresolved: string[];
}

export interface VaultSource {
  entries: readonly VaultEntry[];
  /** Markdown bodies by path. A file with no body is still an item. */
  bodies: ReadonlyMap<string, string>;
}

/** What link resolution needs, so a link can be resolved without a built index. */
export type VaultLookup = Pick<VaultIndex, "byName" | "byReference">;

export interface ResolvedLink {
  item: VaultItem | null;
  ambiguous: boolean;
}

export function buildVaultIndex(source: VaultSource): VaultIndex {
  const entries = [...source.entries].sort((left, right) => left.path.localeCompare(right.path));
  const items = entries.map((entry) => itemFor(entry, source.bodies.get(entry.path)));
  const byPath = new Map(items.map((item) => [item.path, item]));
  const byName = groupBy(items, (item) => item.name);
  const byReference = groupBy(items, (item) => withoutExtension(item.path));
  const lookup: VaultLookup = { byName, byReference };

  const links: VaultLink[] = [];
  const backlinks = new Map<string, string[]>();
  const unresolved = new Set<string>();

  for (const item of items) {
    const linked = new Set<string>();
    for (const link of item.links) {
      const { item: target, ambiguous } = resolveLink(link.target, item, lookup);
      links.push({ from: item.path, target: link.target, to: target?.path ?? null, ambiguous });
      if (!target) {
        unresolved.add(link.target);
        continue;
      }
      if (linked.has(target.path)) continue;
      linked.add(target.path);
      backlinks.set(target.path, [...(backlinks.get(target.path) ?? []), item.path]);
    }
  }

  return {
    items,
    byPath,
    byName,
    byReference,
    links,
    backlinks,
    unresolved: [...unresolved].sort((left, right) => left.localeCompare(right)),
  };
}

/**
 * Resolution order: a path-qualified reference first, then a bare name. A name
 * with several candidates prefers the one in the source's own directory, then the
 * shortest path, then path order — deterministic, and reported as ambiguous either
 * way so the UI can say so rather than quietly picking one.
 */
export function resolveLink(
  target: string,
  from: VaultItem | null,
  lookup: VaultLookup,
): ResolvedLink {
  const key = normalizeReference(target);
  if (key.length === 0) return { item: null, ambiguous: false };

  const byReference = lookup.byReference.get(key);
  if (byReference) return choose(byReference, from);

  const byName = lookup.byName.get(key);
  if (byName) return choose(byName, from);

  return { item: null, ambiguous: false };
}

/**
 * Names appearing in a body without a link to them. This is how a connection the
 * author never made gets surfaced, which is most of what makes a vault readable
 * rather than merely browsable.
 *
 * Quadratic in the number of items: a scan-time derivation meant to be memoised
 * against the vault revision, never computed per frame.
 */
export function unlinkedMentions(index: VaultIndex, minimumNameLength = 3): VaultMention[] {
  const mentions: VaultMention[] = [];

  for (const source of index.items) {
    if (source.text.length === 0) continue;

    const linked = new Set<string>();
    for (const link of source.links) {
      const { item } = resolveLink(link.target, source, index);
      if (item) linked.add(item.path);
    }

    for (const target of index.items) {
      if (target.path === source.path) continue;
      if (linked.has(target.path)) continue;
      const label = target.title ?? target.name;
      if (label.length < minimumNameLength) continue;
      const count = countOccurrences(source.text, label);
      if (count > 0) mentions.push({ source: source.path, target: target.path, count });
    }
  }

  return mentions;
}

/** The linkable name of an entry: a file's stem, or a directory's basename. */
export function entryName(entry: VaultEntry): string {
  const base = baseName(entry.path);
  if (entry.kind === "topic") return base;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base;
  return base.slice(0, dot);
}

function itemFor(entry: VaultEntry, body: string | undefined): VaultItem {
  const source = body ?? "";
  const frontmatter = parseFrontmatter(source);

  return {
    path: entry.path,
    kind: entry.kind,
    dir: directoryOf(entry.path),
    name: entryName(entry),
    meta: frontmatter.meta,
    id: metaString(frontmatter.meta, "id"),
    title: metaString(frontmatter.meta, "title"),
    color: metaString(frontmatter.meta, "color"),
    links: extractLinks(source),
    text: stripCode(frontmatter.body),
  };
}

function choose(candidates: readonly VaultItem[], from: VaultItem | null): ResolvedLink {
  const first = candidates[0];
  if (first === undefined) return { item: null, ambiguous: false };
  if (candidates.length === 1) return { item: first, ambiguous: false };

  const neighbours: VaultItem[] = [];
  if (from) {
    for (const candidate of candidates) {
      if (candidate.dir === from.dir) neighbours.push(candidate);
    }
  }
  const pool = neighbours.length > 0 ? neighbours : candidates;
  const sorted = [...pool].sort(
    (left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path),
  );
  const best = sorted[0];
  if (best === undefined) return { item: null, ambiguous: false };
  return { item: best, ambiguous: true };
}

function groupBy(
  items: readonly VaultItem[],
  key: (item: VaultItem) => string,
): Map<string, VaultItem[]> {
  const groups = new Map<string, VaultItem[]>();
  for (const item of items) {
    const name = key(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return groups;
}

function normalizeReference(target: string): string {
  let key = target.trim().replace(/^\.\//, "");
  if (key.endsWith("/")) key = key.slice(0, -1);
  return key;
}

function withoutExtension(path: string): string {
  const base = baseName(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return path;
  return path.slice(0, path.length - (base.length - dot));
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return path;
  return path.slice(slash + 1);
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return "";
  return path.slice(0, slash);
}

function countOccurrences(text: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "gi");
  return [...text.matchAll(pattern)].length;
}
