import type { CanvasObject } from '@nib-ui/ui-contracts';

export interface BookmarkObject extends CanvasObject {
	kind: 'bookmark';
	x: number;
	y: number;
	url: string;
	title: string;
	domain: string;
	description?: string;
	faviconAssetId?: string;
	imageAssetId?: string;
	w?: number;
	h?: number;
}

export const BOOKMARK_WIDTH = 300;
export const BOOKMARK_MIN_WIDTH = 200;
export const BOOKMARK_MIN_HEIGHT = 76;
/** Title, description and the domain row, with no picture above them. */
export const BOOKMARK_HEIGHT = 116;
/** The same, plus the scraped image across the top. */
export const BOOKMARK_IMAGE_HEIGHT = 236;

export function bookmarkHeight(hasImage: boolean): number {
	return hasImage ? BOOKMARK_IMAGE_HEIGHT : BOOKMARK_HEIGHT;
}

export function parseBookmark(raw: unknown): BookmarkObject | null {
	if (!raw || typeof raw !== 'object') return null;
	const candidate = raw as Partial<BookmarkObject>;
	if (candidate.kind !== 'bookmark' || typeof candidate.id !== 'string') return null;
	if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return null;
	if (typeof candidate.url !== 'string' || candidate.url.length === 0) return null;

	return {
		kind: 'bookmark',
		id: candidate.id,
		x: candidate.x,
		y: candidate.y,
		url: candidate.url,
		title: typeof candidate.title === 'string' ? candidate.title : candidate.url,
		domain: typeof candidate.domain === 'string' ? candidate.domain : domainOf(candidate.url),
		...(typeof candidate.description === 'string' && { description: candidate.description }),
		...(typeof candidate.faviconAssetId === 'string' && { faviconAssetId: candidate.faviconAssetId }),
		...(typeof candidate.imageAssetId === 'string' && { imageAssetId: candidate.imageAssetId }),
		...(typeof candidate.w === 'number' && { w: Math.max(BOOKMARK_MIN_WIDTH, candidate.w) }),
		...(typeof candidate.h === 'number' && { h: Math.max(BOOKMARK_MIN_HEIGHT, candidate.h) }),
	};
}

export function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

/**
 * The single url a paste is, or null. A paste with anything else in it is prose
 * that happens to mention a link, and the board should not turn that into a card.
 */
export function soleUrl(text: string | undefined): string | null {
	const trimmed = text?.trim() ?? '';
	if (trimmed.length === 0 || /\s/.test(trimmed)) return null;
	try {
		const url = new URL(trimmed);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}
