export interface LinkPreview {
	url: string;
	domain: string;
	title: string;
	description?: string;
	faviconAssetId?: string;
	imageAssetId?: string;
}

/**
 * Server-side on purpose: a browser cannot scrape a third-party origin, and the
 * guard against a url that points back at this machine belongs there anyway.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
	const response = await fetch('/api/link-preview', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ url }),
	});
	if (!response.ok) throw new Error(await response.text());
	return (await response.json()) as LinkPreview;
}
