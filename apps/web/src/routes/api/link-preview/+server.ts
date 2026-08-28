import { error, json, type RequestHandler } from '@sveltejs/kit';
import { linkPreviews } from '$lib/server/context';
import { BlockedUrlError } from '$lib/server/link-preview';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
	const url = typeof body?.url === 'string' ? body.url.trim() : '';
	if (url.length === 0) error(400, 'url is required');

	try {
		return json(await linkPreviews().preview(url));
	} catch (cause) {
		// A url the guard refused is the caller's problem, not a server fault, and
		// the reason is safe to report: it never names what was behind the address.
		if (cause instanceof BlockedUrlError) error(400, cause.message);
		if (cause instanceof TypeError) error(400, 'url is not valid');
		error(502, cause instanceof Error ? cause.message : 'link preview failed');
	}
};
