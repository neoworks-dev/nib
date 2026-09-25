// Process bookkeeping: whether something is still alive, a free port, and
// killing everything a session spawned.

import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";

/** Whether a process with this pid exists. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A port nothing is listening on, for the session's devtools endpoint. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not find a free port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Kill every process whose environment carries `marker`, and say how many.
 *
 * `pkill -f` cannot do this: the app's command line is `electron apps/desktop`,
 * which the user's own instance matches too, and the harness children the app
 * spawns — claude, codex, pi — have nothing in theirs to match on at all. What
 * they share is the environment they inherited, and the profile directory in it
 * is this repo's `.nib-debug`, which no instance of the user's has heard of.
 */
export function killByEnvironment(marker: string): number {
  let killed = 0;
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    if (!environmentOf(pid).includes(marker)) continue;
    try {
      process.kill(pid, "SIGKILL");
      killed += 1;
    } catch {
      // Gone between reading /proc and signalling it.
    }
  }
  return killed;
}

/** A process's environment as one NUL-separated string, or empty when unreadable. */
function environmentOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/environ`, "utf8");
  } catch {
    return "";
  }
}
