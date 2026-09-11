import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

const missingBinaryMessage =
  "Claude Code executable not found. Install Claude Code (npm i -g @anthropic-ai/claude-code) or set CLAUDE_EXECUTABLE to its absolute path.";

/**
 * The SDK requires an absolute path here — it does not resolve bare command
 * names via PATH. We deliberately do not ship the vendored per-platform binary
 * (installs run with `--omit optional`), so a system install is mandatory.
 */
export function resolveClaudeExecutable(override?: string): string {
  if (override && isAbsolute(override)) return override;
  const configured = process.env.CLAUDE_EXECUTABLE?.trim();
  if (configured && isAbsolute(configured)) return configured;
  const resolved = findOnPath(configured || "claude");
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
