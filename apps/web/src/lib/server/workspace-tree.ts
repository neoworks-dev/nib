import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { GitFileChange } from "./git-cli";

export interface TreeEntry {
  name: string;
  path: string;
  directory: boolean;
  /** Git porcelain code, `child` when a descendant changed, or null when clean. */
  status: string | null;
}

export interface TreeListing {
  path: string;
  entries: TreeEntry[];
}

export interface TreeOptions {
  /** Names left out of the listing, on top of `.git`, which never appears. */
  skip?: ReadonlySet<string>;
  changes?: readonly GitFileChange[];
}

/**
 * One directory level of a working tree, each entry tagged with its git status,
 * directories first. Null when `path` points outside `cwd`, which the caller
 * answers with a refusal rather than an empty listing.
 */
export async function listWorkspaceTree(
  cwd: string,
  path: string,
  { skip, changes = [] }: TreeOptions = {},
): Promise<TreeListing | null> {
  const relative = path.replace(/^\/+/, "");
  const root = resolve(cwd);
  const absolute = resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}/`)) return null;

  const statusByPath = new Map(changes.map((file) => [file.path, file]));
  const changedPaths = [...statusByPath.keys()];

  const entries: TreeEntry[] = [];
  for (const entry of await safeReadDir(absolute)) {
    if (entry.name === ".git" || skip?.has(entry.name)) continue;
    const entryPath = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    const directory = entry.isDirectory();

    const own = statusByPath.get(entryPath);
    let status: string | null = null;
    if (own) status = own.staged ? own.indexStatus : own.worktreeStatus;
    else if (directory && changedPaths.some((changed) => changed.startsWith(`${entryPath}/`)))
      status = "child";

    entries.push({ name: entry.name, path: entryPath, directory, status });
  }

  entries.sort((left, right) => {
    if (left.directory !== right.directory) return left.directory ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  return { path: relative, entries };
}

async function safeReadDir(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}
