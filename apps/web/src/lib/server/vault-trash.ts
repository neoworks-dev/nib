/**
 * The recycling bin on disk.
 *
 * A delete moves the entry into `.nib/.trash/<id>/`, beside a `meta.json` saying
 * where it came from. Two properties follow from that, and both are the point:
 * the delete is a `rename` inside one filesystem, so it cannot half-happen and
 * costs nothing for a large file; and it is reversible after a reload, not just
 * for as long as the undo stack lives.
 *
 * Restoring is the same move backwards, into a name that is free — the path may
 * have been taken again while the entry sat in the bin, and a restore that
 * overwrote it would be a delete of its own.
 */

import type { Stats } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TRASH_META_FILE, TRASH_DIRECTORY, type TrashEntry, trashEntryId } from "@nib-ui/vault";
import { confineToVault, vaultRoot } from "./vault";
import { cleanVaultPath, freeVaultName, VaultWriteError } from "./vault-write";

/** Moves an entry into the bin, answering with what was filed. */
export async function trashVaultEntry(cwd: string, path: string): Promise<TrashEntry> {
  const root = vaultRoot(cwd);
  const target = cleanVaultPath(path);
  if (target.length === 0) throw new VaultWriteError("nothing to delete", 400);

  const absolute = confineToVault(root, target);
  if (absolute === null) throw new VaultWriteError("path is outside the vault", 400);

  const info = await statOrNull(absolute);
  if (info === null) throw new VaultWriteError(`${target} is gone`, 404);

  const name = baseName(target);
  const entry: TrashEntry = {
    id: trashEntryId(),
    path: target,
    name,
    kind: info.isDirectory() ? "topic" : "file",
    deletedAt: Date.now(),
  };

  const directory = join(root, TRASH_DIRECTORY, entry.id);
  await mkdir(directory, { recursive: true });
  // The metadata is written first: a crash between the two leaves an entry that
  // lists as empty, which is recoverable by hand. The other order loses the path.
  await writeFile(join(directory, TRASH_META_FILE), JSON.stringify(entry), "utf8");
  await rename(absolute, join(directory, name));

  return entry;
}

/**
 * Moves an entry back where it came from. The directory it lived in is recreated
 * if the user deleted that too, and the name it takes is the first free one, which
 * is what the reply reports.
 */
export async function restoreTrashEntry(cwd: string, id: string): Promise<{ path: string }> {
  const root = vaultRoot(cwd);
  const directory = trashEntryDirectory(root, id);
  const entry = await readTrashMeta(directory);
  if (entry === null) throw new VaultWriteError(`${id} is not in the bin`, 404);

  const source = join(directory, entry.name);
  if (!(await exists(source))) throw new VaultWriteError(`${entry.name} is gone`, 404);

  const parent = directoryOf(entry.path);
  const absoluteParent = confineToVault(root, parent);
  if (absoluteParent === null) throw new VaultWriteError("path is outside the vault", 400);
  await mkdir(absoluteParent, { recursive: true });

  const name = await freeVaultName(absoluteParent, entry.name);
  await rename(source, join(absoluteParent, name));
  await rm(directory, { recursive: true, force: true });

  return { path: parent.length === 0 ? name : `${parent}/${name}` };
}

/** What is in the bin, newest first. A malformed entry is skipped, not fatal. */
export async function listTrash(cwd: string): Promise<TrashEntry[]> {
  const root = join(vaultRoot(cwd), TRASH_DIRECTORY);

  let ids: string[];
  try {
    ids = (await readdir(root, { withFileTypes: true }))
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
  } catch {
    // No bin is an empty bin: nothing has been deleted in this project yet.
    return [];
  }

  const entries: TrashEntry[] = [];
  for (const id of ids) {
    const entry = await readTrashMeta(join(root, id));
    if (entry !== null) entries.push(entry);
  }
  return entries.sort((left, right) => right.deletedAt - left.deletedAt);
}

/**
 * Throws the bytes away for good — one entry, or the whole bin when no id is
 * given. This is the only call here that destroys anything.
 */
export async function purgeTrash(cwd: string, id?: string): Promise<void> {
  const root = join(vaultRoot(cwd), TRASH_DIRECTORY);
  if (id === undefined) {
    await rm(root, { recursive: true, force: true });
    return;
  }
  await rm(trashEntryDirectory(vaultRoot(cwd), id), { recursive: true, force: true });
}

/**
 * An id names one directory inside the bin and nothing else: a path separator or
 * a climb in it would reach the vault it is meant to be confined to.
 */
function trashEntryDirectory(root: string, id: string): string {
  if (!/^[0-9a-z]+-[0-9a-z]+$/.test(id)) throw new VaultWriteError("not a bin entry", 400);
  return join(root, TRASH_DIRECTORY, id);
}

async function readTrashMeta(directory: string): Promise<TrashEntry | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(directory, TRASH_META_FILE), "utf8"));
    return isTrashEntry(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isTrashEntry(value: unknown): value is TrashEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<TrashEntry>;
  if (typeof entry.id !== "string" || typeof entry.path !== "string") return false;
  if (typeof entry.name !== "string" || typeof entry.deletedAt !== "number") return false;
  return entry.kind === "file" || entry.kind === "topic";
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  // No slash means the entry sat at the vault root, whose directory is the root.
  if (slash === -1) return "";
  return path.slice(0, slash);
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

async function exists(absolute: string): Promise<boolean> {
  return (await statOrNull(absolute)) !== null;
}

async function statOrNull(absolute: string): Promise<Stats | null> {
  try {
    return await stat(absolute);
  } catch {
    return null;
  }
}
