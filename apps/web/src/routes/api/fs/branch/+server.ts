import { json, type RequestHandler } from '@sveltejs/kit';
import { git, workspace } from '$lib/server/context';

export const GET: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path') ?? '';
	// The start screen asks about a path the user is still typing or picking, so a
	// missing directory is an expected answer rather than an error.
	if (path.trim().length === 0 || !(await workspace().isDirectory(path))) return json({ branch: null });

	return json({ branch: await git().branch(path) });
};
