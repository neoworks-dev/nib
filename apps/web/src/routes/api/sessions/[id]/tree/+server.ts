import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { git } from '$lib/server/context';
import { sessionCwd } from '$lib/server/session-cwd';

const skipped = new Set(['.git', 'node_modules', '.svelte-kit', 'dist', 'build', 'target', '.nib-ui']);

/** One directory level of the workspace, each entry tagged with its git status. */
export const GET: RequestHandler = async ({ params, url }) => {
	const cwd = sessionCwd(params.id!);
	if (!cwd) error(404, `unknown session "${params.id}"`);

	const relative = (url.searchParams.get('path') ?? '').replace(/^\/+/, '');
	const absolute = resolve(cwd, relative);
	if (absolute !== cwd && !absolute.startsWith(`${cwd}/`)) error(403, 'path is outside the workspace');

	const [entries, status] = await Promise.all([safeReadDir(absolute), git().status(cwd)]);
	const statusByPath = new Map(status.files.map((file) => [file.path, file]));

	return json({
		path: relative,
		entries: entries
			.filter((entry) => !skipped.has(entry.name))
			.map((entry) => {
				const path = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
				const own = statusByPath.get(path);
				const child = entry.isDirectory()
					? [...statusByPath.keys()].some((changed) => changed.startsWith(`${path}/`))
					: false;
				return {
					name: entry.name,
					path,
					directory: entry.isDirectory(),
					status: own ? (own.staged ? own.indexStatus : own.worktreeStatus) : child ? 'child' : null,
				};
			})
			.sort((left, right) =>
				left.directory === right.directory ? left.name.localeCompare(right.name) : left.directory ? -1 : 1,
			),
	});
};

async function safeReadDir(path: string) {
	try {
		return await readdir(path, { withFileTypes: true });
	} catch {
		return [];
	}
}
