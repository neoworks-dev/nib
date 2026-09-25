// The running session, as a file on disk: every command is its own process, and
// this is how the next one finds the app the last one started.

import { readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { paths } from "./paths.ts";
import { isRunning } from "./processes.ts";

export interface Session {
  display: string;
  displayPid: number;
  appPid: number;
  port: number;
  project: string;
  startedAt: string;
}

/**
 * The session, or null when none is running.
 *
 * A session file outliving its app is the common case — the machine slept, the
 * app crashed, someone killed it — so a dead app reads as no session rather
 * than a timeout against a port nothing is listening on.
 */
export function readSession(): Session | null {
  let session: Session;
  try {
    session = JSON.parse(readFileSync(paths.session, "utf8"));
  } catch {
    return null;
  }
  if (!isRunning(session.appPid)) return null;
  return session;
}

/** The session, or an error telling the caller to start one. */
export function requireSession(): Session {
  const session = readSession();
  if (!session) throw new Error('no session is running — "bun run debug start" first');
  return session;
}

/** Record a freshly started session. */
export function writeSession(session: Session): void {
  writeFileSync(paths.session, JSON.stringify(session, null, 2), "utf8");
}

/** Forget the session. */
export async function clearSession(): Promise<void> {
  await rm(paths.session, { force: true });
}
