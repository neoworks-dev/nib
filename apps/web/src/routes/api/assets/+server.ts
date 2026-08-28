import { error, json, type RequestHandler } from '@sveltejs/kit';
import { AssetTooLargeError, MAX_ASSET_BYTES, UnsupportedAssetError } from '$lib/server/asset-store';
import { assets } from '$lib/server/context';

export const POST: RequestHandler = async ({ request }) => {
	const declared = Number(request.headers.get('content-length') ?? '0');
	if (declared > MAX_ASSET_BYTES) error(413, 'asset is too large');

	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.byteLength === 0) error(400, 'asset is empty');

	try {
		// The user picked this file: anything that is not a known media type but
		// reads as text is kept as text rather than refused.
		return json(await assets().store(bytes, { allowText: true }));
	} catch (cause) {
		if (cause instanceof AssetTooLargeError) error(413, cause.message);
		// The bytes decide the type, so a rejection means we cannot render it either.
		if (cause instanceof UnsupportedAssetError) error(415, cause.message);
		throw cause;
	}
};
