import { error, type RequestHandler } from '@sveltejs/kit';
import { workspace } from '$lib/server/context';

export const GET: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path') ?? '';
	if (path.trim().length === 0) error(400, 'path is required');

	const icon = await workspace().findIcon(path);
	// Most workspaces have no icon; the miss is cached so the sidebar does not re-probe on every mount.
	if (!icon) return new Response(null, { status: 404, headers: { 'cache-control': 'private, max-age=300' } });

	return new Response(icon.bytes, {
		headers: {
			'content-type': icon.contentType,
			'content-length': String(icon.bytes.byteLength),
			// Workspace SVGs are untrusted markup: block scripts if the URL is opened directly.
			'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
			'x-content-type-options': 'nosniff',
			'cache-control': 'private, max-age=300',
		},
	});
};
