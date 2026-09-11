import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fuzzyRank } from "@nib-ui/ui-contracts";

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryListing {
  base: string;
  entries: DirectoryEntry[];
}

export interface FileMatch {
  path: string;
  score: number;
}

const skippedDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "__pycache__",
  "vendor",
]);

/** Walking a huge tree per keystroke is not worth it — stop once the budget is spent. */
const walkBudget = 20_000;
const walkCacheTtlMs = 5_000;
const walkCache = new Map<string, { expiresAt: number; files: string[] }>();

export function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

/**
 * Autocomplete probe: a trailing slash lists the directory's children, anything
 * else treats the last segment as a prefix to match inside its parent.
 */
export async function listDirectories(input: string, limit = 40): Promise<DirectoryListing> {
  const expanded = expandHome(input.trim());
  if (expanded.length === 0) return readDirectories(homedir(), "", limit);
  if (!isAbsolute(expanded)) return { base: expanded, entries: [] };
  if (expanded.endsWith("/")) return readDirectories(resolve(expanded), "", limit);
  return readDirectories(dirname(expanded), basename(expanded), limit);
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(expandHome(path))).isDirectory();
  } catch {
    return false;
  }
}

export async function searchFiles(cwd: string, query: string, limit = 20): Promise<FileMatch[]> {
  const files = await cachedWalk(resolve(expandHome(cwd)));
  if (query.trim().length === 0) return files.slice(0, limit).map((path) => ({ path, score: 0 }));
  return fuzzyRank(files, query, (path) => path, limit).map(({ item, score }) => ({
    path: item,
    score,
  }));
}

async function readDirectories(
  base: string,
  prefix: string,
  limit: number,
): Promise<DirectoryListing> {
  const entries = await safeReadDir(base);
  const directories = entries
    .filter((entry) => entry.isDirectory() && !isNoise(entry.name))
    .map((entry) => ({ name: entry.name, path: join(base, entry.name) }));

  if (prefix.length === 0) return { base, entries: directories.slice(0, limit) };
  const ranked = fuzzyRank(directories, prefix, (entry) => entry.name, limit);
  return { base, entries: ranked.map((match) => match.item) };
}

async function cachedWalk(root: string): Promise<string[]> {
  const cached = walkCache.get(root);
  if (cached && cached.expiresAt > Date.now()) return cached.files;
  const files = await walk(root);
  walkCache.set(root, { expiresAt: Date.now() + walkCacheTtlMs, files });
  return files;
}

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [""];
  while (queue.length > 0 && files.length < walkBudget) {
    const relative = queue.shift()!;
    for (const entry of await safeReadDir(join(root, relative))) {
      if (isNoise(entry.name)) continue;
      const path = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files;
}

async function safeReadDir(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isNoise(name: string): boolean {
  return name.startsWith(".") || skippedDirectories.has(name);
}
