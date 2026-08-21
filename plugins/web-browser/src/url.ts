const embeddableProtocols = new Set(['http:', 'https:']);
const searchEndpoint = 'https://duckduckgo.com/?q=';

/** Loopback dev servers are practically never served over TLS, so they default to http. */
const loopbackHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

const schemePattern = /^[a-z][a-z0-9+.-]*:/i;
/** `localhost:5173` looks like `scheme:` to a URL parser, so authority-with-port is matched first. */
const hostWithPortPattern = /^[^\s/?#:]+:\d+(?:[/?#]|$)/;

function parseAbsoluteUrl(candidate: string): URL | null {
	try {
		return new URL(candidate);
	} catch {
		return null;
	}
}

function searchUrl(query: string): string {
	return `${searchEndpoint}${encodeURIComponent(query)}`;
}

/**
 * Turns whatever the user typed into an absolute http(s) URL, falling back to a web search.
 * Returns null when the input carries a scheme the panel refuses to load — `javascript:`,
 * `data:` and `file:` would run inside the iframe or expose the host filesystem.
 */
export function normalizeUrl(input: string): string | null {
	const trimmed = input.trim();
	if (trimmed.length === 0) return null;

	if (schemePattern.test(trimmed) && !hostWithPortPattern.test(trimmed)) {
		const parsed = parseAbsoluteUrl(trimmed);
		if (!parsed || !embeddableProtocols.has(parsed.protocol)) return null;
		return parsed.href;
	}

	if (/\s/.test(trimmed)) return searchUrl(trimmed);

	const authority = trimmed.split(/[/?#]/, 1)[0] ?? '';
	const host = authority.split(':', 1)[0] ?? '';
	if (!hostWithPortPattern.test(trimmed) && !host.includes('.')) return searchUrl(trimmed);

	const scheme = loopbackHosts.has(host.toLowerCase()) ? 'http://' : 'https://';
	const parsed = parseAbsoluteUrl(`${scheme}${trimmed}`);
	if (!parsed || !embeddableProtocols.has(parsed.protocol) || parsed.hostname.length === 0) return searchUrl(trimmed);
	return parsed.href;
}

/** Hostname for a tab label; empty when the URL has no host or does not parse. */
export function displayHost(url: string): string {
	const parsed = parseAbsoluteUrl(url);
	if (!parsed) return '';
	return parsed.hostname.replace(/^www\./, '');
}
