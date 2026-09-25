// Handing one action to the node driver.

import { spawnSync } from "node:child_process";
import { paths, repoRoot } from "./paths.ts";
import type { Session } from "./session.ts";

/**
 * Run one action in the driver and return its JSON output.
 *
 * A process per action, because `connectOverCDP` has to run under node and
 * nothing needs remembering between two of them. Node's start-up is the price,
 * and it is smaller than the class of bug a long-lived driver holding a stale
 * page would buy.
 */
export function drive(session: Session, command: Record<string, unknown>): string {
  const result = spawnSync(
    "node",
    [paths.driver, String(session.port), paths.refs, JSON.stringify(command)],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const output = (result.stderr || result.stdout || "").trim();
    throw new Error(`${String(command.action)} failed: ${output}`);
  }
  return result.stdout.trim();
}

/** Parse the driver's output, or say plainly that it was not JSON. */
export function parseDriverOutput<T>(output: string): T {
  try {
    const parsed: T = JSON.parse(output);
    return parsed;
  } catch {
    throw new Error(`the driver answered with something that is not JSON:\n${output}`);
  }
}
