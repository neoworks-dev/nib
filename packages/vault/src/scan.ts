/**
 * Reading the vault off disk. Thin on purpose: everything derived lives in
 * `tree.ts`, so this file only has to walk a directory and read the markdown.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { buildVaultIndex, type VaultEntry, type VaultIndex, type VaultSource } from "./tree";

/** Not content: a nested repository or an installed dependency is not a topic. */
export const DEFAULT_SKIPPED_DIRECTORIES: readonly string[] = [".git", "node_modules"];

/** Matches the file route's own cap, so the scan cannot read what a panel cannot open. */
export const DEFAULT_MAX_FILE_BYTES = 1_048_576;

export interface ScanOptions {
  skipDirectories?: readonly string[];
  maxFileBytes?: number;
}

const MARKDOWN = [".md", ".markdown"];

export async function readVault(
  vaultRoot: string,
  options: ScanOptions = {},
): Promise<VaultSource> {
  const context: WalkContext = {
    entries: [],
    bodies: new Map(),
    skip: new Set(options.skipDirectories ?? DEFAULT_SKIPPED_DIRECTORIES),
    maxBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  };

  await walk(vaultRoot, "", context);
  return { entries: context.entries, bodies: context.bodies };
}

export async function scanVault(vaultRoot: string, options: ScanOptions = {}): Promise<VaultIndex> {
  return buildVaultIndex(await readVault(vaultRoot, options));
}

interface WalkContext {
  entries: VaultEntry[];
  bodies: Map<string, string>;
  skip: ReadonlySet<string>;
  maxBytes: number;
}

async function walk(directory: string, prefix: string, context: WalkContext): Promise<void> {
  let dirents: Dirent[];
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch {
    // A vault that does not exist yet reads as an empty one, and a directory that
    // cannot be read costs its own contents, not the boot.
    return;
  }

  for (const dirent of dirents) {
    const path = prefix.length === 0 ? dirent.name : `${prefix}/${dirent.name}`;

    if (dirent.isDirectory()) {
      if (context.skip.has(dirent.name)) continue;
      context.entries.push({ path, kind: "topic" });
      await walk(join(directory, dirent.name), path, context);
      continue;
    }

    // Symlinks are not followed: a link back up the tree would loop forever.
    if (!dirent.isFile()) continue;
    context.entries.push({ path, kind: "file" });

    const body = await readBody(join(directory, dirent.name), dirent.name, context.maxBytes);
    if (body !== null) context.bodies.set(path, body);
  }
}

async function readBody(
  absolutePath: string,
  name: string,
  maxBytes: number,
): Promise<string | null> {
  if (!isMarkdown(name)) return null;
  try {
    const info = await stat(absolutePath);
    if (info.size > maxBytes) return null;
    return await readFile(absolutePath, "utf8");
  } catch {
    return null;
  }
}

function isMarkdown(name: string): boolean {
  return MARKDOWN.some((extension) => name.endsWith(extension));
}
