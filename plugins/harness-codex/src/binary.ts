import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

const missingBinaryMessage =
  "Codex executable not found. Install the Codex CLI (npm i -g @openai/codex) or set CODEX_EXECUTABLE to its absolute path.";

/**
 * The SDK would otherwise resolve the CLI from the per-platform binaries vendored
 * under `@openai/codex`, which `install:lean` (`bun install --omit optional`)
 * never fetches. Resolving here and passing `codexPathOverride` keeps the SDK on
 * the system CLI and turns a missing install into a readable error.
 */
export function resolveCodexExecutable(override?: string): string {
  if (override && isAbsolute(override)) return override;
  const configured = process.env.CODEX_EXECUTABLE?.trim();
  if (configured && isAbsolute(configured)) return configured;
  const resolved = findOnPath(configured || "codex");
  if (!resolved) throw new Error(missingBinaryMessage);
  return resolved;
}

function findOnPath(command: string): string | null {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}
