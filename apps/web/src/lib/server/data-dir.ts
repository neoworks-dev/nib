import { mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Everything the app keeps between runs lives here. Sessions used to be written
 * into `./.nib-ui/sessions` relative to wherever the server happened to start,
 * which made the transcript history depend on the launch directory.
 */
export function dataHome(): string {
  const base = process.env.XDG_DATA_HOME?.trim();
  return join(base && base.length > 0 ? base : join(homedir(), ".local", "share"), "nib-ui");
}

export function sessionsDirectory(): string {
  return join(dataHome(), "sessions");
}

export function boardsDirectory(): string {
  return join(dataHome(), "boards");
}

export function assetsDirectory(): string {
  return join(dataHome(), "assets");
}

export function linkPreviewsDirectory(): string {
  return join(dataHome(), "link-previews");
}

/**
 * Moves logs written by an earlier build into the XDG directory. A name already
 * taken there wins — the new location is authoritative — so re-running this is a
 * no-op rather than an overwrite. The legacy directory is removed only when it
 * empties out on its own.
 */
export function migrateLegacySessionLogs(
  legacyDirectory: string,
  target = sessionsDirectory(),
): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(legacyDirectory).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  if (names.length === 0) return [];

  mkdirSync(target, { recursive: true });
  const existing = new Set(readdirSync(target));
  const moved: string[] = [];

  for (const name of names) {
    if (existing.has(name)) continue;
    try {
      renameSync(join(legacyDirectory, name), join(target, name));
      moved.push(name);
    } catch {
      // A cross-device rename or a permission problem costs the old transcript,
      // not the boot: the session simply stays where it was.
    }
  }

  try {
    rmdirSync(legacyDirectory);
  } catch {
    // Still holds files this build did not claim.
  }
  return moved;
}
