// Screenshot file names, numbered so a run reads back in the order it happened.

import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths.ts";

/** The path the next screenshot is written to: `NNN-label.png`. */
export function nextShotPath(label: string | undefined): string {
  mkdirSync(paths.shots, { recursive: true });
  const taken = readdirSync(paths.shots).filter((name) => name.endsWith(".png")).length;
  const number = String(taken + 1).padStart(3, "0");
  let name = "shot";
  if (label !== undefined) name = label;
  return join(paths.shots, `${number}-${slug(name)}.png`);
}

/** The screenshot just written, by the numbering `nextShotPath` hands out. */
export function latestShot(): string | null {
  const taken = readdirSync(paths.shots)
    .filter((name) => name.endsWith(".png"))
    .sort();
  const last = taken.at(-1);
  if (last === undefined) return null;
  return join(paths.shots, last);
}

/** A string reduced to lowercase letters, digits and dashes, for a file name. */
export function slug(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .toLowerCase()
    .slice(0, 40);
}

/** Now, as a file-name-safe timestamp. */
export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
