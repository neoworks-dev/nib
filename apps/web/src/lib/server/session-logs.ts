/**
 * Where a transcript lives. **In the vault of the project it is about** (PLAN §7):
 * a chat belongs to its topic, so it has to be retrievable by location like
 * everything else, and `Read`/`Grep` reach it because it is inside the harness's
 * own working directory.
 *
 * A session with no topic lands at the vault root rather than in an invented
 * `inbox/` (PLAN §15 q2): the root board *is* the project, and a directory that
 * exists only because the app made one is the metadata decision 2 rules out.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { VAULT_DIRECTORY } from "@nib-ui/vault";
import { boardsDirectory, sessionsDirectory } from "./data-dir";

/** The directory a project's transcripts are written to. */
export function sessionLogDirectory(cwd: string): string {
  return join(cwd, VAULT_DIRECTORY);
}

/**
 * Every project this machine has a board for. The board index is the only record
 * of which directories have been opened, and a transcript cannot be restored
 * without knowing where to look for it.
 */
export function knownProjectDirectories(): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(boardsDirectory()).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  const directories = new Set<string>();
  for (const name of names) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(boardsDirectory(), name), "utf8"));
      const cwd = (parsed as { cwd?: unknown }).cwd;
      if (typeof cwd === "string" && cwd.length > 0) directories.add(cwd);
    } catch {
      // A board that will not parse costs its own transcripts, not the boot.
    }
  }
  return [...directories].sort((left, right) => left.localeCompare(right));
}

/** Every vault that might hold a transcript, plus the legacy XDG directory. */
export function sessionLogDirectories(): string[] {
  return [...knownProjectDirectories().map(sessionLogDirectory), sessionsDirectory()];
}

/**
 * Moves `$XDG_DATA_HOME/nib-ui/sessions/*.jsonl` into the vault of the project
 * each one is about (PLAN §12 step 1). The log says which directory that is —
 * `session.created` carries `cwd` — so nothing has to be guessed, and a log whose
 * project is gone is left exactly where it is rather than filed somewhere wrong.
 *
 * Idempotent, and never an overwrite: a name already taken in the vault wins.
 */
export function migrateSessionLogsIntoVaults(legacyDirectory = sessionsDirectory()): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(legacyDirectory).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }

  const moved: string[] = [];
  for (const name of names) {
    const source = join(legacyDirectory, name);
    const cwd = readLoggedCwd(source);
    if (cwd === null || !existsSync(cwd)) continue;

    const target = sessionLogDirectory(cwd);
    if (existsSync(join(target, name))) continue;
    try {
      mkdirSync(target, { recursive: true });
      renameSync(source, join(target, name));
      moved.push(join(target, name));
    } catch {
      // A cross-device rename or a read-only project costs this transcript's
      // relocation, not the boot: it stays readable where it already is.
    }
  }

  try {
    rmdirSync(legacyDirectory);
  } catch {
    // Still holds logs whose projects are gone.
  }
  return moved;
}

/**
 * The working directory a transcript was recorded against. Only the opening lines
 * are read: `session.created` is the first event a host writes, and a log can be
 * megabytes of turns after it.
 */
function readLoggedCwd(path: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  for (const line of raw.split("\n", 20)) {
    if (line.length === 0) continue;
    try {
      const event: unknown = JSON.parse(line);
      const data = (event as { data?: { cwd?: unknown } }).data;
      if (typeof data?.cwd === "string" && data.cwd.length > 0) return data.cwd;
    } catch {
      return null;
    }
  }
  return null;
}
