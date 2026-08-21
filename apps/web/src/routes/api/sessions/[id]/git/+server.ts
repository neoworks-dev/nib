import { error, json, type RequestHandler } from '@sveltejs/kit';
import { git } from '$lib/server/context';
import { sessionCwd } from '$lib/server/session-cwd';

export const GET: RequestHandler = async ({ params }) => {
	const cwd = sessionCwd(params.id!);
	if (!cwd) error(404, `unknown session "${params.id}"`);
	return json(await git().status(cwd));
};
