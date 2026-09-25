/**
 * Mutating the vault: the `mv` a drag performs, the file a drop writes, and the
 * delete a card offers.
 *
 * Every path here is vault-relative and confined by `confineToVault`, which is why
 * these routes live under `/api/vault` rather than under `/api/fs`: `/api/fs` is
 * the unconfined workspace probe, and nothing in this file may reach outside one
 * project's `.nib`.
 *
 * **The app owns `mv`** (PLAN §4): a move rewrites every path-qualified link to
 * the moved entry in the same operation, so links survive a drag even though they
 * would not survive a `git mv`.
 */

import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { movedLinkTarget, rewriteLinks } from "@nib-ui/vault";
import { confineToVault, vaultRoot } from "./vault";

/** Carries the status a route should answer with, so the handler does not guess. */
export class VaultWriteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VaultWriteError";
  }
}

export interface VaultMoveResult {
  from: string;
  to: string;
  /** Vault-relative paths whose bodies were rewritten, for an exact reversal. */
  rewritten: string[];
}

export interface VaultMoveOptions {
  /**
   * Restricts the rewrite to these paths. The undo of a move passes back what the
   * move reported, so reversing it cannot touch a link elsewhere that was already
   * written the way the move would have produced.
   */
  rewrite?: readonly string[];
}

/**
 * Moves an entry into a directory of the vault, keeping its own name. The
 * destination is a directory because that is the gesture: the topic a drop lands
 * in is the destination directory (PLAN §5).
 */
export async function moveVaultEntry(
  cwd: string,
  from: string,
  toDirectory: string,
  options: VaultMoveOptions = {},
): Promise<VaultMoveResult> {
  const root = vaultRoot(cwd);
  const source = cleanVaultPath(from);
  if (source.length === 0) throw new VaultWriteError("nothing to move", 400);

  const directory = cleanVaultPath(toDirectory);
  const name = baseName(source);
  const target = directory.length === 0 ? name : `${directory}/${name}`;
  if (target === source) return { from: source, to: source, rewritten: [] };

  // A topic cannot swallow itself: the rename succeeds on some platforms and
  // orphans the subtree on others.
  if (directory === source || directory.startsWith(`${source}/`))
    throw new VaultWriteError("a topic cannot be moved inside itself", 400);

  const absoluteSource = confineToVault(root, source);
  const absoluteTarget = confineToVault(root, target);
  const absoluteDirectory = confineToVault(root, directory);
  if (!absoluteSource || !absoluteTarget || !absoluteDirectory)
    throw new VaultWriteError("path is outside the vault", 400);

  if (!(await exists(absoluteSource))) throw new VaultWriteError(`${source} is gone`, 404);
  if (await exists(absoluteTarget)) throw new VaultWriteError(`${target} already exists`, 409);

  await mkdir(absoluteDirectory, { recursive: true });
  await rename(absoluteSource, absoluteTarget);

  const rewritten = await rewriteVaultLinks(root, source, target, options.rewrite);
  return { from: source, to: target, rewritten };
}

export interface VaultWriteResult {
  /** Where the bytes landed, which is not the requested name when one was taken. */
  path: string;
}

/**
 * Writes bytes into a topic directory under a name derived from `name`. A name
 * already in use gets a numeric suffix rather than overwriting: a drop never
 * destroys what the vault already holds.
 */
export async function writeVaultFile(
  cwd: string,
  directory: string,
  name: string,
  bytes: Uint8Array,
): Promise<VaultWriteResult> {
  const root = vaultRoot(cwd);
  const target = cleanVaultPath(directory);
  const absolute = confineToVault(root, target);
  if (absolute === null) throw new VaultWriteError("path is outside the vault", 400);

  await mkdir(absolute, { recursive: true });
  const chosen = await freeVaultName(absolute, safeName(name));
  await writeFile(join(absolute, chosen), bytes);

  return { path: target.length === 0 ? chosen : `${target}/${chosen}` };
}

/**
 * Writes a note's body back, in place.
 *
 * **Link-safe**: the path in is the path out. A note whose title changes is not
 * renamed to match, because every `[[link]]` to it resolves by name (PLAN §4) and
 * a rename here would silently break all of them — the app owns `mv`, and a save
 * is not a move. It also never creates a directory, so a typo in a path cannot
 * quietly scatter empty folders through the vault.
 *
 * Written beside the target and renamed over it, so a crash mid-write leaves the
 * previous body rather than half of the new one.
 */
export async function writeVaultText(cwd: string, path: string, text: string): Promise<void> {
  const target = cleanVaultPath(path);
  if (target.length === 0) throw new VaultWriteError("nothing to write", 400);

  const absolute = confineToVault(vaultRoot(cwd), target);
  if (absolute === null) throw new VaultWriteError("path is outside the vault", 400);

  // A directory would be replaced by a file, which is a delete wearing a save's
  // clothes. The parent has to be there already: this writes, it does not create.
  const existing = await statOrNull(absolute);
  if (existing?.isDirectory()) throw new VaultWriteError(`${target} is a directory`, 409);
  if (existing === null && !(await exists(join(absolute, "..")))) {
    throw new VaultWriteError(`${target} has nowhere to live`, 404);
  }

  const temporary = `${absolute}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, absolute);
}

/**
 * Deletes an entry outright. Unlinking a card from a board is the board's own
 * business and never reaches here; this is the destructive one, and a topic takes
 * its contents with it.
 */
export async function deleteVaultEntry(cwd: string, path: string): Promise<void> {
  const target = cleanVaultPath(path);
  if (target.length === 0) throw new VaultWriteError("nothing to delete", 400);

  const absolute = confineToVault(vaultRoot(cwd), target);
  if (absolute === null) throw new VaultWriteError("path is outside the vault", 400);
  if (!(await exists(absolute))) throw new VaultWriteError(`${target} is gone`, 404);

  await rm(absolute, { recursive: true, force: true });
}

/**
 * Rewrites `[[old/path]]` to `[[new/path]]` across the vault's markdown. A
 * bare-name link is left alone because the name did not change, so in a vault that
 * links by name — the way the guide asks for — this rewrites nothing and still
 * costs a walk. That walk is the price of the one case it does fix.
 */
async function rewriteVaultLinks(
  root: string,
  from: string,
  to: string,
  only: readonly string[] | undefined,
): Promise<string[]> {
  const rename = movedLinkTarget(from, to);
  const candidates = only ? [...only] : await markdownPaths(root, "");
  const rewritten: string[] = [];

  for (const path of candidates) {
    const absolute = confineToVault(root, path);
    if (absolute === null) continue;
    let body: string;
    try {
      body = await readFile(absolute, "utf8");
    } catch {
      continue;
    }
    const next = rewriteLinks(body, rename);
    if (next === body) continue;
    await writeFile(absolute, next);
    rewritten.push(path);
  }

  return rewritten.sort((left, right) => left.localeCompare(right));
}

const MARKDOWN = [".md", ".markdown"];
const SKIPPED = new Set([".git", "node_modules"]);

async function markdownPaths(root: string, prefix: string): Promise<string[]> {
  const directory = prefix.length === 0 ? root : join(root, prefix);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIPPED.has(entry.name)) continue;
      paths.push(...(await markdownPaths(root, path)));
      continue;
    }
    if (entry.isFile() && MARKDOWN.some((extension) => entry.name.endsWith(extension)))
      paths.push(path);
  }
  return paths;
}

/** Punctuation a name may not carry into a filesystem, or into a vault path. */
const UNSAFE_PUNCTUATION = new Set(["/", "\\", ":", "*", "?", '"', "<", ">", "|"]);

/**
 * A name a filesystem will take: no separators, no control characters — a newline
 * in a filename is legal on POSIX and ruins every listing that reads one — no
 * leading dot that would hide the file inside its own vault, and never empty.
 */
function safeName(name: string): string {
  const base = baseName(name.trim().replace(/\\/g, "/")).replace(/^\.+/, "");
  // Code points, not UTF-16 units: the map below must not split a surrogate pair
  // and turn an emoji in a filename into two replacement dashes.
  const cleaned = Array.from(base)
    .map((character) => {
      if (UNSAFE_PUNCTUATION.has(character)) return "-";
      return (character.codePointAt(0) ?? 0x20) < 0x20 ? "-" : character;
    })
    .join("")
    .trim();
  return cleaned.length > 0 ? cleaned : "untitled";
}

/**
 * The requested name, or the first suffixed one that is not taken. Shared with the
 * bin: restoring a deleted entry lands beside whatever took its place rather than
 * over it.
 */
export async function freeVaultName(directory: string, name: string): Promise<string> {
  // A dot at position 0 is a leading dot, which `safeName` already stripped, so
  // this splits a name that really does carry an extension and nothing else.
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = name.slice(stem.length);

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = attempt === 0 ? name : `${stem}-${attempt}${extension}`;
    if (!(await exists(join(directory, candidate)))) return candidate;
  }
  throw new VaultWriteError(`no free name for ${name}`, 409);
}

async function exists(absolute: string): Promise<boolean> {
  return (await statOrNull(absolute)) !== null;
}

async function statOrNull(absolute: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(absolute);
  } catch {
    return null;
  }
}

/** Vault paths are POSIX and relative; anything absolute or climbing is refused. */
export function cleanVaultPath(path: string): string {
  const normalized = posix.normalize(path.trim().replace(/\\/g, "/"));
  if (normalized === "." || normalized === "/") return "";
  const stripped = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  if (stripped === ".." || stripped.startsWith("../"))
    throw new VaultWriteError("path is outside the vault", 400);
  return stripped;
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return path;
  return path.slice(slash + 1);
}
