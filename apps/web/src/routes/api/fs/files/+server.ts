import { error, json, type RequestHandler } from '@sveltejs/kit';
import { workspace } from '$lib/server/context';

export const GET: RequestHandler = async ({ url }) => {
	const cwd = url.searchParams.get('cwd');
	if (!cwd) error(400, 'cwd is required');
	const limit = Number(url.searchParams.get('limit') ?? 20);
	const files = await workspace().searchFiles(cwd, url.searchParams.get('q') ?? '', limit);
	return json({ files });
};
