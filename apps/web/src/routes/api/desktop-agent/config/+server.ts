import { error, json, type RequestHandler } from '@sveltejs/kit';
import { readDesktopConfig, writeDesktopConfig } from '$lib/server/desktop-config';

export const GET: RequestHandler = async () => json(await readDesktopConfig());

export const PUT: RequestHandler = async ({ request }) => {
	const body: unknown = await request.json().catch(() => null);
	// An array or a scalar would replace the document with something no rule can be read
	// out of, and the next read would silently answer "every application is unknown".
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'the config must be an object');
	return json(await writeDesktopConfig(body as Record<string, unknown>));
};
