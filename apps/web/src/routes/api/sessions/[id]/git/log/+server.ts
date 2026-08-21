import { error, json, type RequestHandler } from '@sveltejs/kit';
import { git } from '$lib/server/context';
import { sessionCwd } from '$lib/server/session-cwd';

const defaultLimit = 200;
const maxLimit = 1000;

export const GET: RequestHandler = async ({ params, url }) => {
	const cwd = sessionCwd(params.id!);
	if (!cwd) error(404, `unknown session "${params.id}"`);

	const requested = Number(url.searchParams.get('limit') ?? '') || defaultLimit;
	const limit = Math.min(Math.max(Math.trunc(requested), 1), maxLimit);

	const commits = await git().log(cwd, limit);
	// An empty log is ambiguous: a repository without commits looks like a non-repository.
	const repository = commits.length > 0 || (await git().status(cwd)).repository;
	return json({ repository, commits });
};
