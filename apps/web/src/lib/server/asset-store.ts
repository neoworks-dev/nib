import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

export interface StoredAsset {
	/** `<sha256>.<ext>` — content-addressed, so the same paste never stores twice. */
	assetId: string;
	contentType: string;
	byteLength: number;
}

interface Signature {
	extension: string;
	contentType: string;
	matches(bytes: Uint8Array): boolean;
}

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
	if (bytes.length < offset + magic.length) return false;
	return magic.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/**
 * The client's declared type is not trusted: the bytes decide. Anything not
 * listed is refused rather than stored under a guessed extension — in
 * particular SVG, which is a script-carrying document however it is served.
 */
const SIGNATURES: Signature[] = [
	{
		extension: 'png',
		contentType: 'image/png',
		matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	},
	{ extension: 'jpg', contentType: 'image/jpeg', matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
	{
		extension: 'gif',
		contentType: 'image/gif',
		matches: (bytes) => ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a',
	},
	{
		extension: 'webp',
		contentType: 'image/webp',
		matches: (bytes) => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP',
	},
	// Favicons are still overwhelmingly ICO, and a link card wants one.
	{
		extension: 'ico',
		contentType: 'image/x-icon',
		matches: (bytes) => startsWith(bytes, [0x00, 0x00, 0x01, 0x00]),
	},
	{ extension: 'pdf', contentType: 'application/pdf', matches: (bytes) => ascii(bytes, 0, 5) === '%PDF-' },
	{
		extension: 'webm',
		contentType: 'video/webm',
		matches: (bytes) => startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]),
	},
	// Every ISO base media file — mp4, m4v, QuickTime — carries `ftyp` at byte 4.
	{ extension: 'mp4', contentType: 'video/mp4', matches: (bytes) => ascii(bytes, 4, 4) === 'ftyp' },
	{ extension: 'glb', contentType: 'model/gltf-binary', matches: (bytes) => ascii(bytes, 0, 4) === 'glTF' },
	{ extension: 'stl', contentType: 'model/stl', matches: isStl },
	{ extension: 'obj', contentType: 'model/obj', matches: isObj },
];

/**
 * STL is the one mesh format worth storing that carries no magic number. A binary
 * one is identified by arithmetic — the triangle count in its header has to
 * account for exactly the rest of the file — and an ASCII one by its two keywords.
 */
function isStl(bytes: Uint8Array): boolean {
	if (bytes.byteLength >= 84) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		if (84 + view.getUint32(80, true) * 50 === bytes.byteLength) return true;
	}
	const head = ascii(bytes, 0, Math.min(bytes.byteLength, 512));
	return head.startsWith('solid') && head.includes('facet');
}

/** Statements a wavefront obj is allowed to open a line with. */
const OBJ_KEYWORDS = new Set([
	'v',
	'vn',
	'vt',
	'vp',
	'f',
	'l',
	'p',
	'o',
	'g',
	's',
	'usemtl',
	'mtllib',
	'mg',
	'cstype',
	'deg',
	'curv',
	'curv2',
	'surf',
	'end',
]);

/**
 * A wavefront obj is plain text with no magic number, and the faces of a large
 * one can sit past any window worth reading. It is identified instead by the head
 * being nothing but obj statements, with at least one vertex among them — a text
 * file that is not an obj carries a line this grammar does not allow.
 */
function isObj(bytes: Uint8Array): boolean {
	// A utf-8 byte order mark is what a Windows exporter opens the file with.
	const start = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
	const head = ascii(bytes, start, Math.min(bytes.byteLength - start, 4096));
	// Any NUL says the file is binary however its first lines happen to read.
	if (head.includes('\0')) return false;

	let vertices = 0;
	const lines = head.split('\n');
	// The last line of the window is almost certainly cut in half.
	for (const line of lines.slice(0, Math.max(1, lines.length - 1))) {
		const statement = line.trim();
		if (statement.length === 0 || statement.startsWith('#')) continue;
		const keyword = statement.slice(0, statement.search(/\s|$/));
		if (!OBJ_KEYWORDS.has(keyword)) return false;
		if (keyword === 'v') vertices += 1;
	}
	return vertices > 0;
}

/**
 * The one thing stored on what it is *not*: anything that decodes as UTF-8 and
 * carries no NUL is kept as plain text, whatever its extension claimed. An svg or
 * an html file lands here, so it can be attached to a prompt and read as a
 * document, and can never come back out of the store as an image.
 */
const TEXT_FALLBACK: Signature = { extension: 'txt', contentType: 'text/plain', matches: isUtf8Text };

function isUtf8Text(bytes: Uint8Array): boolean {
	if (bytes.byteLength === 0) return false;
	if (bytes.includes(0x00)) return false;
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}

export function sniffAsset(bytes: Uint8Array): Signature | null {
	return SIGNATURES.find((signature) => signature.matches(bytes)) ?? null;
}

export class UnsupportedAssetError extends Error {
	constructor() {
		super('unsupported asset type');
		this.name = 'UnsupportedAssetError';
	}
}

export class AssetTooLargeError extends Error {
	constructor(readonly limit = MAX_ASSET_BYTES) {
		super(`asset exceeds ${limit} bytes`);
		this.name = 'AssetTooLargeError';
	}
}

/** Rejects an id that is not one this store could have minted. */
export function isAssetId(value: string): boolean {
	return /^[0-9a-f]{64}\.[a-z0-9]{2,4}$/.test(value);
}

export function contentTypeOf(assetId: string): string | null {
	const extension = assetId.slice(assetId.lastIndexOf('.') + 1);
	return [...SIGNATURES, TEXT_FALLBACK].find((signature) => signature.extension === extension)?.contentType ?? null;
}

export interface StoreAssetOptions {
	/**
	 * Keeps a payload no signature claims when it decodes as UTF-8 text. Set by the
	 * upload routes, which take whatever the user picked; a scraper that asked for
	 * an image leaves it off so a page of html is still a refusal.
	 */
	allowText?: boolean;
}

export async function storeAsset(directory: string, bytes: Uint8Array, options?: StoreAssetOptions): Promise<StoredAsset> {
	if (bytes.byteLength > MAX_ASSET_BYTES) throw new AssetTooLargeError();
	const sniffed = sniffAsset(bytes);
	const signature = sniffed ?? (options?.allowText && isUtf8Text(bytes) ? TEXT_FALLBACK : null);
	if (!signature) throw new UnsupportedAssetError();

	const digest = createHash('sha256').update(bytes).digest('hex');
	const assetId = `${digest}.${signature.extension}`;
	const path = join(directory, assetId);

	await mkdir(directory, { recursive: true });
	// Written beside the target and renamed: a crash mid-write must not leave a
	// truncated file under a hash that says the bytes are complete.
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, bytes);
	await rename(temporary, path);

	return { assetId, contentType: signature.contentType, byteLength: bytes.byteLength };
}

export async function readAsset(
	directory: string,
	assetId: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
	if (!isAssetId(assetId)) return null;
	const contentType = contentTypeOf(assetId);
	if (!contentType) return null;

	try {
		return { bytes: await readFile(join(directory, assetId)), contentType };
	} catch {
		return null;
	}
}

/**
 * Where the bytes actually sit, for a consumer that hands the file to something
 * outside this process. Null when the id is not one this store could have minted
 * or the file is no longer there, so a caller never passes on a path that lies.
 */
export async function assetPath(directory: string, assetId: string): Promise<string | null> {
	if (!isAssetId(assetId) || !contentTypeOf(assetId)) return null;
	const path = join(directory, assetId);
	try {
		await stat(path);
		return path;
	} catch {
		return null;
	}
}
