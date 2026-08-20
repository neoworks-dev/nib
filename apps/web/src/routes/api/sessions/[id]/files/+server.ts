import { error, json, type RequestHandler } from '@sveltejs/kit';
import { sessionHost, workspace } from '$lib/server/context';

/** The cwd comes from the session, so a client can only search where its agent runs. */
export const GET: RequestHandler = async ({ params, url }) => {
	const summary = sessionHost()
		.list()
		.find((session) => session.id === params.id);
	if (!summary) error(404, `unknown session "${params.id}"`);

	const limit = Number(url.searchParams.get('limit') ?? 20);
	const files = await workspace().searchFiles(summary.cwd, url.searchParams.get('query') ?? '', limit);
	return json({ cwd: summary.cwd, files });
};
