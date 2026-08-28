import type { Plugin } from '@nib-ui/kernel';
import { boardTheme, TextTextureCache } from '@nib-ui/plugin-canvas';
import { assetUrl } from '@nib-ui/plugin-canvas-media';
import type { Point } from '@nib-ui/ui-contracts';
import { bookmarkKind } from './BookmarkRenderer';
import { bookmarkHeight, BOOKMARK_WIDTH, domainOf, parseBookmark, soleUrl, type BookmarkObject } from './bookmark';
import { fetchLinkPreview } from './client';

let counter = 0;

function createId(): string {
	counter += 1;
	return `bookmark:${Date.now().toString(36)}:${counter.toString(36)}`;
}

export const canvasLinksPlugin: Plugin = {
	name: 'canvas-links',
	inject: ['canvas'],
	apply(ctx) {
		const canvas = ctx.require('canvas');
		const textures = new TextTextureCache(64);

		ctx.effect(() =>
			canvas.registerKind(
				bookmarkKind({
					textures,
					theme: boardTheme,
					assetUrl,
					openUrl: (url) => void globalThis.open(url, '_blank', 'noopener,noreferrer'),
				}),
			),
		);

		/**
		 * The card is placed before the scrape returns, so a slow site does not look
		 * like a dropped paste, then filled in once the metadata arrives.
		 */
		const place = async (url: string, at: Point): Promise<boolean> => {
			const id = createId();
			canvas.addObject({
				kind: 'bookmark',
				id,
				x: Math.round(at.x),
				y: Math.round(at.y),
				url,
				title: url,
				domain: domainOf(url),
				w: BOOKMARK_WIDTH,
				h: bookmarkHeight(false),
			} satisfies BookmarkObject);

			const preview = await fetchLinkPreview(url).catch(() => null);
			// A scrape that failed leaves the url as the title, which is still a link.
			if (preview) {
				canvas.updateObject(id, {
					url: preview.url,
					title: preview.title,
					domain: preview.domain,
					// The picture only takes room once it is known there is one.
					h: bookmarkHeight(Boolean(preview.imageAssetId)),
					...(preview.description && { description: preview.description }),
					...(preview.faviconAssetId && { faviconAssetId: preview.faviconAssetId }),
					...(preview.imageAssetId && { imageAssetId: preview.imageAssetId }),
				});
			}
			return true;
		};

		// After the media handlers: a copied image carries an HTML fallback whose
		// text is a url, and the picture is the better reading of that paste.
		ctx.effect(() =>
			canvas.registerPasteHandler({
				order: 20,
				handle: (payload, at) => {
					const url = soleUrl(payload.text);
					return url ? place(url, at) : false;
				},
			}),
		);
		ctx.effect(() =>
			canvas.registerDropHandler({
				order: 20,
				handle: (payload, at) => {
					const url = soleUrl(payload.uri) ?? soleUrl(payload.text);
					return url ? place(url, at) : false;
				},
			}),
		);
		// A bookmark has no file to hand over: what a task can do with it is the url,
		// so that is what travels in the prompt.
		ctx.effect(() =>
			canvas.registerContextProvider({
				order: 20,
				contextFor: (object) => {
					const bookmark = parseBookmark(object);
					if (!bookmark) return null;
					return {
						label: bookmark.title,
						text: bookmark.title === bookmark.url ? bookmark.url : `${bookmark.title} — ${bookmark.url}`,
					};
				},
			}),
		);

		ctx.effect(() => () => textures.clear());
	},
};

export { fetchLinkPreview, type LinkPreview } from './client';
export {
	BOOKMARK_MIN_HEIGHT,
	BOOKMARK_MIN_WIDTH,
	BOOKMARK_WIDTH,
	domainOf,
	parseBookmark,
	soleUrl,
	type BookmarkObject,
} from './bookmark';
