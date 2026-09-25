// Where the debug harness keeps what a session leaves behind. Everything lives
// under `.nib-debug/` at the repo root, which is gitignored.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Screenshots, refs, logs, reports and the isolated profile. */
export const debugRoot = join(repoRoot, ".nib-debug");

export const paths = {
  session: join(debugRoot, "session.json"),
  refs: join(debugRoot, "refs.json"),
  pace: join(debugRoot, "pace.json"),
  shots: join(debugRoot, "shots"),
  reports: join(debugRoot, "reports"),
  appLog: join(debugRoot, "app.log"),
  profile: join(debugRoot, "profile"),
  driver: join(repoRoot, "scripts", "debug", "driver", "main.ts"),
  charters: join(repoRoot, ".claude", "skills", "nib-debug", "charters"),
};
