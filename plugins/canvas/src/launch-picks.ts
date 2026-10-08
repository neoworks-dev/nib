import type { LaunchPicks } from "./workstream";

/** Where the board composer's last picks live, so a new workstream starts where the last one did. */
export const launchPicksStorageKey = "nib-ui.launch-picks";

const pickKeys = ["harnessId", "model", "permissionMode", "effort"] as const;

/** Reads stored picks back; anything unreadable is dropped rather than blocking the board. */
export function parseLaunchPicks(raw: string | null): LaunchPicks {
  let stored: unknown;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    return {};
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};

  const picks: LaunchPicks = {};
  for (const key of pickKeys) {
    const value: unknown = Reflect.get(stored, key);
    if (typeof value === "string") picks[key] = value;
  }
  return picks;
}

/** The picks from the last session of the app, or none when storage is unavailable. */
export function loadLaunchPicks(): LaunchPicks {
  try {
    return parseLaunchPicks(localStorage.getItem(launchPicksStorageKey));
  } catch {
    return {};
  }
}

/** Keeps the picks for the next launch of the app. */
export function saveLaunchPicks(picks: LaunchPicks): void {
  try {
    localStorage.setItem(launchPicksStorageKey, JSON.stringify(picks));
  } catch {
    // A blocked storage quota must not undo the pick the user just made in memory.
  }
}
