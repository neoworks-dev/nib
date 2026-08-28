import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

const missingBinaryMessage =
	'nib server not found. Set NIB_URL to an already-running server, NIB_EXECUTABLE to a compiled ' +
	'binary, or NIB_PATH to a nib checkout (started with bun). Installing nib on PATH also works.';

/**
 * How to start a nib server.
 *
 * nib serves over `Bun.serve`, so a checkout has to be launched with `bun` — Node
 * cannot run it. A `bun build --compile` binary carries its own runtime and is
 * launched directly.
 */
export function resolveNibCommand(): string[] {
	const executable = process.env.NIB_EXECUTABLE?.trim();
	if (executable && isAbsolute(executable)) return [executable];

	const checkout = process.env.NIB_PATH?.trim();
	if (checkout) {
		const entry = join(checkout, 'src', 'index.ts');
		if (!isFile(entry)) throw new Error(`NIB_PATH does not contain src/index.ts: ${checkout}`);
		const bun = findOnPath('bun');
		if (!bun) throw new Error('NIB_PATH names a nib checkout, but bun is not on PATH to run it.');
		return [bun, 'run', entry];
	}

	const onPath = findOnPath(executable || 'nib');
	if (!onPath) throw new Error(missingBinaryMessage);
	return [onPath];
}

function findOnPath(command: string): string | null {
	for (const directory of (process.env.PATH ?? '').split(delimiter)) {
		if (directory.length === 0) continue;
		const candidate = join(directory, command);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}
	return null;
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}
