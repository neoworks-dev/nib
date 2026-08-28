import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { storeAsset } from './asset-store';

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 8_000;

/**
 * Both pictures are asset ids, never urls: a board that hotlinked would keep
 * reporting the user's interest back to the previewed origin every time it drew.
 */
export interface LinkPreview {
	url: string;
	domain: string;
	title: string;
	description?: string;
	faviconAssetId?: string;
	imageAssetId?: string;
}

/** Everything the head scanner found, before an image is copied into the store. */
export interface LinkMetadata {
	title: string;
	description?: string;
	favicon?: string;
	image?: string;
}

export class BlockedUrlError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = 'BlockedUrlError';
	}
}

function parseIpv4(address: string): number[] | null {
	const parts = address.split('.');
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => Number(part));
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
	return octets;
}

/**
 * Anything that is not a routable public address. The url is attacker-supplied
 * whenever a transcript or a page the agent visited suggested it, so a preview
 * must never become a request to something only this machine can reach.
 */
export function isBlockedAddress(address: string): boolean {
	const version = isIP(address);
	if (version === 0) return true;

	if (version === 4) {
		const [a, b] = parseIpv4(address) as [number, number, number, number];
		if (a === 0 || a === 10 || a === 127) return true;
		if (a === 169 && b === 254) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 192 && b === 0) return true;
		if (a === 198 && (b === 18 || b === 19)) return true;
		if (a === 100 && b >= 64 && b <= 127) return true;
		// Multicast, reserved and broadcast.
		if (a >= 224) return true;
		return false;
	}

	const normalized = address.toLowerCase().split('%')[0]!;
	// An IPv4-mapped address reaches the same host the v4 rules cover.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
	if (mapped) return isBlockedAddress(mapped[1]!);
	if (normalized === '::' || normalized === '::1') return true;

	const group = Number.parseInt(normalized.split(':')[0] || '0', 16);
	// fc00::/7 unique local, fe80::/10 link local, ff00::/8 multicast.
	if ((group & 0xfe00) === 0xfc00) return true;
	if ((group & 0xffc0) === 0xfe80) return true;
	if ((group & 0xff00) === 0xff00) return true;
	return false;
}

export type Resolver = (hostname: string) => Promise<string[]>;

const systemResolver: Resolver = async (hostname) => {
	const records = await lookup(hostname, { all: true });
	return records.map((record) => record.address);
};

/**
 * Throws unless the url is http(s) and every address its host resolves to is
 * public. Re-run on each redirect hop: the first url being safe says nothing
 * about where it points.
 */
export async function assertPublicUrl(url: URL, resolve: Resolver = systemResolver): Promise<void> {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new BlockedUrlError(`unsupported protocol ${url.protocol}`);
	}

	const hostname = url.hostname.replace(/^\[|\]$/g, '');
	if (isIP(hostname) !== 0) {
		if (isBlockedAddress(hostname)) throw new BlockedUrlError(`blocked address ${hostname}`);
		return;
	}

	const addresses = await resolve(hostname).catch(() => []);
	if (addresses.length === 0) throw new BlockedUrlError(`cannot resolve ${hostname}`);
	// Every record, not just the first: a host with one public and one private
	// address is a rebinding attempt, not a fallback.
	for (const address of addresses) {
		if (isBlockedAddress(address)) throw new BlockedUrlError(`blocked address ${address}`);
	}
}

function decodeEntities(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&');
}

const ATTRIBUTE = /([a-z0-9:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function attributes(tag: string): Record<string, string> {
	const found: Record<string, string> = {};
	for (const match of tag.matchAll(ATTRIBUTE)) {
		const value = match[3] ?? match[4] ?? match[5] ?? '';
		found[match[1]!.toLowerCase()] = decodeEntities(value).trim();
	}
	return found;
}

/**
 * A scanner over the document head rather than a parser. Bun's `HTMLRewriter` is
 * not an option: the packaged app runs this server inside Electron, on Node,
 * where that global does not exist.
 */
export function parseLinkMetadata(html: string): LinkMetadata {
	const headEnd = html.search(/<\/head\s*>/i);
	const head = headEnd === -1 ? html.slice(0, 64_000) : html.slice(0, headEnd);

	const open: Record<string, string> = {};
	const twitter: Record<string, string> = {};
	let favicon: string | undefined;

	for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
		const tag = attributes(match[0]);
		const content = tag.content;
		if (!content) continue;
		const key = (tag.property ?? tag.name ?? '').toLowerCase();
		if (key.startsWith('og:')) open[key.slice(3)] ??= content;
		else if (key.startsWith('twitter:')) twitter[key.slice(8)] ??= content;
		else if (key === 'description') twitter.description ??= content;
	}

	for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
		const tag = attributes(match[0]);
		const rel = (tag.rel ?? '').toLowerCase();
		if (!tag.href) continue;
		// `icon` wins over `shortcut icon` and `apple-touch-icon` only by arriving first.
		if (rel === 'icon' || rel === 'shortcut icon' || rel === 'apple-touch-icon') favicon ??= tag.href;
	}

	const titleTag = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
	const title = open.title ?? twitter.title ?? (titleTag ? decodeEntities(titleTag[1]!).trim() : '');
	const description = open.description ?? twitter.description;
	const image = open.image ?? open['image:url'] ?? twitter.image;

	return {
		title: title.replace(/\s+/g, ' ').trim(),
		...(description && { description: description.replace(/\s+/g, ' ').trim() }),
		...(favicon && { favicon }),
		...(image && { image }),
	};
}

/** Relative urls in the head resolve against the url the redirects ended at. */
export function absoluteUrl(href: string, base: URL): string | undefined {
	try {
		return new URL(href, base).toString();
	} catch {
		return undefined;
	}
}

async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
	const body = response.body;
	if (!body) return new Uint8Array(0);

	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = body.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			// Stops pulling rather than buffering a response that lied about its length.
			const room = limit - total;
			if (value.byteLength >= room) {
				chunks.push(value.subarray(0, room));
				total = limit;
				break;
			}
			chunks.push(value);
			total += value.byteLength;
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export interface FetchOptions {
	resolve?: Resolver;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

/**
 * Follows redirects by hand so every hop is checked before it is taken —
 * `redirect: 'follow'` would have already made the request the guard exists to
 * prevent.
 */
async function guardedFetch(
	start: URL,
	limit: number,
	accept: string,
	options: FetchOptions,
): Promise<{ url: URL; bytes: Uint8Array; contentType: string }> {
	const call = options.fetchImpl ?? fetch;
	let url = start;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
		await assertPublicUrl(url, options.resolve);
		const response = await call(url, {
			redirect: 'manual',
			headers: { accept, 'accept-encoding': 'identity', 'user-agent': 'nib-ui link preview' },
			...(options.signal && { signal: options.signal }),
		});

		const location = response.headers.get('location');
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel().catch(() => undefined);
			const next = absoluteUrl(location, url);
			if (!next) throw new BlockedUrlError('redirect to an unreadable location');
			url = new URL(next);
			continue;
		}

		if (!response.ok) throw new Error(`link preview failed with ${response.status}`);
		const declared = Number(response.headers.get('content-length') ?? '0');
		if (declared > limit) throw new Error('link preview response is too large');

		return {
			url,
			bytes: await readCapped(response, limit),
			contentType: response.headers.get('content-type') ?? '',
		};
	}

	throw new BlockedUrlError('too many redirects');
}

/**
 * Scrapes a url and copies its preview image into the asset store, so a board
 * never hotlinks back to the previewed origin.
 */
export async function fetchLinkPreview(
	rawUrl: string,
	assetsDirectory: string,
	options: FetchOptions = {},
): Promise<LinkPreview> {
	const requested = new URL(rawUrl);
	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

	const page = await guardedFetch(requested, MAX_HTML_BYTES, 'text/html,application/xhtml+xml', {
		...options,
		signal,
	});
	const metadata = parseLinkMetadata(new TextDecoder().decode(page.bytes));

	/** A picture the board can keep, or nothing — a preview is worth having without one. */
	const copy = async (href: string | undefined): Promise<string | undefined> => {
		const resolved = href ? absoluteUrl(href, page.url) : undefined;
		if (!resolved) return undefined;
		try {
			const image = await guardedFetch(new URL(resolved), MAX_IMAGE_BYTES, 'image/*', { ...options, signal });
			return (await storeAsset(assetsDirectory, image.bytes)).assetId;
		} catch {
			// Unreachable, refused by the guard, or a type the store will not keep —
			// `data:` favicons and svg among them.
			return undefined;
		}
	};

	const [imageAssetId, faviconAssetId] = await Promise.all([copy(metadata.image), copy(metadata.favicon)]);
	return {
		url: page.url.toString(),
		domain: page.url.hostname.replace(/^www\./, ''),
		title: metadata.title.length > 0 ? metadata.title : page.url.hostname,
		...(metadata.description && { description: metadata.description }),
		...(faviconAssetId && { faviconAssetId }),
		...(imageAssetId && { imageAssetId }),
	};
}
