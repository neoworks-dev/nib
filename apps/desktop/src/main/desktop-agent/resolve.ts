/**
 * Where the sidecar binary is. Resolved, never bundled: the same stance the repo takes for
 * the Claude Code CLI, so nothing is cross-compiled and `electron-builder.yml` is untouched.
 *
 * The filesystem probe is injected so the resolution rules are testable without a binary,
 * a `$PATH` or a platform.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export const SIDECAR_NAME = 'nib-overlay';

export const SIDECAR_OVERRIDE_VARIABLE = 'NIB_OVERLAY_EXECUTABLE';

export interface SidecarResolution {
	executable: string | null;
	/** Why nothing resolved, or why an override was not used. Null when one was found. */
	detail: string | null;
}

/** True for a file that exists and carries the execute bit. */
export function isExecutableFile(candidate: string): boolean {
	try {
		if (!statSync(candidate).isFile()) return false;
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * An override that does not resolve is reported rather than quietly ignored: someone who
 * set the variable meant that binary, and falling back to `$PATH` would run a different
 * one without saying so.
 */
export function resolveSidecar(
	env: Record<string, string | undefined>,
	isExecutable: (candidate: string) => boolean = isExecutableFile,
): SidecarResolution {
	const override = env[SIDECAR_OVERRIDE_VARIABLE];
	if (override && override.length > 0) {
		if (isExecutable(override)) return { executable: override, detail: null };
		return {
			executable: null,
			detail: `$${SIDECAR_OVERRIDE_VARIABLE} points at ${override}, which is not an executable file.`,
		};
	}

	for (const directory of (env.PATH ?? '').split(delimiter)) {
		if (directory.length === 0) continue;
		const candidate = join(directory, SIDECAR_NAME);
		if (isExecutable(candidate)) return { executable: candidate, detail: null };
	}

	return {
		executable: null,
		detail: `No ${SIDECAR_NAME} binary is on $PATH. Build it with \`task build:overlay\` or set $${SIDECAR_OVERRIDE_VARIABLE}.`,
	};
}
