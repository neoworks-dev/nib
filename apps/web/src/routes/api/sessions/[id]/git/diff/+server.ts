import { error, json, type RequestHandler } from '@sveltejs/kit';
import { git } from '$lib/server/context';
import { sessionCwd } from '$lib/server/session-cwd';

export const GET: RequestHandler = async ({ params, url }) => {
	const cwd = sessionCwd(params.id!);
	if (!cwd) error(404, `unknown session "${params.id}"`);
	const path = url.searchParams.get('path');
	if (!path) error(400, 'path is required');
	return json({ patch: await git().diff(cwd, path, url.searchParams.get('staged') === 'true') });
};
