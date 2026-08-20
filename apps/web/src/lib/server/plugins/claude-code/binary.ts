import { isAbsolute } from 'node:path';

const missingBinaryMessage =
	'Claude Code executable not found. Install Claude Code (npm i -g @anthropic-ai/claude-code) or set CLAUDE_EXECUTABLE to its absolute path.';

/**
 * The SDK requires an absolute path here — it does not resolve bare command
 * names via PATH. We deliberately do not ship the vendored per-platform binary
 * (installs run with `--omit optional`), so a system install is mandatory.
 */
export function resolveClaudeExecutable(): string {
	const configured = process.env.CLAUDE_EXECUTABLE?.trim();
	if (configured && isAbsolute(configured)) return configured;
	const resolved = configured ? Bun.which(configured) : Bun.which('claude');
	if (!resolved) throw new Error(missingBinaryMessage);
	return resolved;
}
