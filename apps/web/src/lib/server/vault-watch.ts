/**
 * Liveness for the vault: a file the model writes mid-session shows up without a
 * reload (PLAN §14 step 6).
 *
 * One watcher per project, shared by every subscriber, because a recursive watch
 * is an inotify tree and a board pane per window would otherwise open one each.
 * The event carries nothing but "it changed": the client re-reads the vault, which
 * is the same path a manual refresh takes, so there is one way to get a scan.
 */

import { type FSWatcher, watch } from "node:fs";
import { mkdirSync } from "node:fs";
import type { Disposer } from "@nib-ui/kernel";
import { vaultRoot } from "./vault";

/** Writes arrive one `write(2)` at a time; a save is several. Coalesce them. */
const SETTLE_MS = 120;

interface Watch {
  watcher: FSWatcher | null;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

const watches = new Map<string, Watch>();

/**
 * Calls `listener` after the vault under `cwd` settles. Returns a disposer; the
 * underlying watcher closes when the last subscriber goes.
 */
export function watchVault(cwd: string, listener: () => void): Disposer {
  const root = vaultRoot(cwd);
  let entry = watches.get(root);

  if (!entry) {
    entry = { watcher: null, listeners: new Set(), timer: null };
    watches.set(root, entry);
    entry.watcher = open(root, entry);
  }

  entry.listeners.add(listener);
  const held = entry;

  return () => {
    held.listeners.delete(listener);
    if (held.listeners.size > 0) return;
    if (held.timer) clearTimeout(held.timer);
    held.watcher?.close();
    watches.delete(root);
  };
}

/**
 * A recursive watch is not portable — it is native on Linux and macOS and absent
 * elsewhere — so a failure falls back to watching the vault's own directory. That
 * still catches a new topic or a note at the root, which is most of what a model
 * writes first, and it never costs the boot.
 */
function open(root: string, entry: Watch): FSWatcher | null {
  try {
    mkdirSync(root, { recursive: true });
  } catch {
    return null;
  }

  const fire = (): void => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      for (const listener of [...entry.listeners]) listener();
    }, SETTLE_MS);
  };

  try {
    const watcher = watch(root, { recursive: true }, fire);
    watcher.on("error", () => {});
    return watcher;
  } catch {
    try {
      const watcher = watch(root, fire);
      watcher.on("error", () => {});
      return watcher;
    } catch {
      return null;
    }
  }
}
