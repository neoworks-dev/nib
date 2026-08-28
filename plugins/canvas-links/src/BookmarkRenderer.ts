import { Assets, Container, Graphics, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';
import {
	drawCornerHandles,
	ObjectRenderer,
	pointInRect,
	resizeHandleAt,
	resolutionForZoom,
	themeRevision,
	type BoardTheme,
	type PressableRenderer,
	type ResizableRenderer,
	type ResizeHandle,
	type TextTextureCache,
} from '@nib-ui/plugin-canvas';
import type { CanvasEngineApi, CanvasObjectKind, Point, Rect } from '@nib-ui/ui-contracts';
import {
	BOOKMARK_MIN_HEIGHT,
	BOOKMARK_MIN_WIDTH,
	BOOKMARK_WIDTH,
	parseBookmark,
	type BookmarkObject,
} from './bookmark';

const RADIUS = 10;
const RING_OFFSET = 3;
const PAD = 12;
const IMAGE_RATIO = 0.52;

export interface BookmarkDeps {
	textures: TextTextureCache;
	theme(): BoardTheme;
	/** Opening a bookmark is the app's call, not the renderer's. */
	openUrl(url: string): void;
	/** `/api/assets/<id>` — supplied by the media plugin so links owns no route for it. */
	assetUrl(assetId: string): string;
}

/**
 * A scraped link. The picture is an asset the server already copied, so the card
 * never fetches from the previewed origin.
 */
export class BookmarkRenderer
	extends ObjectRenderer<BookmarkObject>
	implements ResizableRenderer, PressableRenderer
{
	readonly container = new Container();

	private readonly background = new Graphics();
	private readonly imageMask = new Graphics();
	private readonly ring = new Graphics();
	private readonly handles = new Graphics();
	private readonly titleSprite = new Sprite();
	private readonly metaSprite = new Sprite();
	private readonly faviconSprite = new Sprite();
	private image: Sprite | null = null;

	private data: BookmarkObject | null = null;
	private width = BOOKMARK_WIDTH;
	private height = BOOKMARK_MIN_HEIGHT;
	private imageHeight = 0;
	private resizeFrom: { width: number; height: number } | null = null;
	private hotHandle: ResizeHandle | null = null;
	private pointer: Point | null = null;
	private selected = false;
	private loadedAssetId = '';
	private signature = '';
	private chromeZoom = 0;

	constructor(
		private readonly engine: CanvasEngineApi,
		private readonly deps: BookmarkDeps,
	) {
		super();
		this.container.eventMode = 'static';
		this.container.cursor = 'pointer';
		this.container.addChild(
			this.background,
			this.imageMask,
			this.ring,
			this.titleSprite,
			this.faviconSprite,
			this.metaSprite,
			this.handles,
		);
		this.faviconSprite.visible = false;

		this.container.on('pointerleave', () => {
			this.pointer = null;
			this.hotHandle = null;
			this.drawChrome();
		});
		this.container.on('pointermove', (event: FederatedPointerEvent) => {
			this.pointer = event.getLocalPosition(this.container);
			this.drawChrome();
		});
	}

	sync(data: BookmarkObject, selection: string[]): void {
		this.data = data;
		this.width = Math.max(BOOKMARK_MIN_WIDTH, data.w ?? BOOKMARK_WIDTH);
		this.height = Math.max(BOOKMARK_MIN_HEIGHT, data.h ?? BOOKMARK_MIN_HEIGHT);
		this.selected = selection.includes(data.id);

		const assetId = `${data.imageAssetId ?? ''} ${data.faviconAssetId ?? ''}`;
		if (assetId !== this.loadedAssetId) {
			this.loadedAssetId = assetId;
			void this.loadImage(data);
			void this.loadFavicon(data);
		}

		const signature = [data.url, data.title, this.width, this.height, this.selected ? 1 : 0, themeRevision()].join(' ');
		if (signature !== this.signature) {
			this.signature = signature;
			this.redraw();
		}
		if (Math.abs(this.engine.camera.zoom - this.chromeZoom) > this.chromeZoom * 0.02) this.drawChrome();

		this.container.pivot.set(this.width / 2, this.height / 2);
		this.container.position.set(data.x + this.width / 2, data.y + this.height / 2);
	}

	override bounds(): Rect {
		const data = this.data;
		return { x: data?.x ?? 0, y: data?.y ?? 0, width: this.width, height: this.height };
	}

	override hitTest(worldX: number, worldY: number): boolean {
		return pointInRect(worldX, worldY, this.bounds());
	}

	/** A press anywhere but a resize handle opens the link. */
	pressAt(worldX: number, worldY: number): boolean {
		const data = this.data;
		if (!data || this.handleAt(worldX, worldY)) return false;
		if (!pointInRect(worldX, worldY, this.bounds())) return false;
		this.deps.openUrl(data.url);
		return true;
	}

	handleAt(worldX: number, worldY: number): ResizeHandle | null {
		const bounds = this.bounds();
		return resizeHandleAt(worldX - bounds.x, worldY - bounds.y, this.width, this.height, this.engine.camera.zoom);
	}

	hoverHandle(handle: ResizeHandle | null): void {
		if (handle === this.hotHandle) return;
		this.hotHandle = handle;
		this.drawChrome();
	}

	beginResize(): void {
		this.resizeFrom = { width: this.width, height: this.height };
	}

	applyResize(handle: ResizeHandle, deltaX: number, deltaY: number, preserveAspect: boolean): void {
		const from = this.resizeFrom;
		const data = this.data;
		if (!from || !data) return;

		const growX = handle.includes('e') ? deltaX : handle.includes('w') ? -deltaX : 0;
		const growY = handle.startsWith('s') ? deltaY : handle.startsWith('n') ? -deltaY : 0;
		let width = Math.max(BOOKMARK_MIN_WIDTH, from.width + growX);
		let height = Math.max(BOOKMARK_MIN_HEIGHT, from.height + growY);
		if (preserveAspect) height = Math.max(BOOKMARK_MIN_HEIGHT, width * (from.height / from.width));

		width = Math.round(width);
		height = Math.round(height);
		const x = handle.includes('w') ? data.x + (from.width - width) : data.x;
		const y = handle.startsWith('n') ? data.y + (from.height - height) : data.y;
		this.engine.updateObject(data.id, { x: Math.round(x), y: Math.round(y), w: width, h: height });
	}

	endResize(): void {
		this.resizeFrom = null;
	}

	private async loadImage(data: BookmarkObject): Promise<void> {
		this.image?.destroy();
		this.image = null;
		if (!data.imageAssetId) {
			this.signature = '';
			return;
		}

		try {
			const texture = (await Assets.load(this.deps.assetUrl(data.imageAssetId))) as Texture;
			// The card may have been removed or repointed while the bytes loaded.
			if (this.data?.imageAssetId !== data.imageAssetId) return;
			this.image = new Sprite(texture);
			this.image.mask = this.imageMask;
			this.container.addChildAt(this.image, this.container.getChildIndex(this.background) + 1);
		} catch {
			this.image = null;
		}
		this.signature = '';
	}

	private async loadFavicon(data: BookmarkObject): Promise<void> {
		const assetId = data.faviconAssetId;
		if (!assetId) {
			this.faviconSprite.visible = false;
			return;
		}
		try {
			const texture = (await Assets.load(this.deps.assetUrl(assetId))) as Texture;
			if (this.data?.faviconAssetId !== assetId) return;
			this.faviconSprite.texture = texture;
			this.faviconSprite.visible = true;
		} catch {
			// An icon a browser cannot decode just leaves the domain on its own.
			this.faviconSprite.visible = false;
		}
		this.signature = '';
	}

	private redraw(): void {
		const data = this.data;
		const theme = this.deps.theme();
		if (!data) return;

		this.imageHeight = this.image ? Math.round(this.height * IMAGE_RATIO) : 0;

		const graphics = this.background;
		graphics.clear();
		graphics.roundRect(0, 0, this.width, this.height, RADIUS);
		graphics.fill({ color: theme.card });
		graphics.roundRect(0.5, 0.5, this.width - 1, this.height - 1, RADIUS);
		graphics.stroke({ width: 1, color: theme.border });

		// The picture is square-cornered at the bottom: it butts onto the text.
		const mask = this.imageMask;
		mask.clear();
		if (this.image) {
			mask.roundRect(0, 0, this.width, this.imageHeight + RADIUS, RADIUS);
			mask.fill({ color: 0xffffff });
			this.image.setSize(this.width, this.imageHeight);
			this.image.position.set(0, 0);
		}

		const contentWidth = Math.max(1, this.width - PAD * 2);
		const resolution = resolutionForZoom(this.engine.camera.zoom);
		const textTop = this.imageHeight + (this.image ? 10 : PAD);

		const title = this.deps.textures.get(
			`bookmark:${themeRevision()}:${data.id}:${data.title}`,
			[
				{ text: data.title, size: 12.5, weight: 600, color: theme.text, maxLines: 2, lineHeight: 17 },
				...(data.description
					? [{ text: data.description, size: 10.5, color: theme.dim, maxLines: 2, lineHeight: 15 } as const]
					: []),
			],
			contentWidth,
			resolution,
		);
		this.titleSprite.texture = title.texture;
		this.titleSprite.setSize(title.width, title.height);
		this.titleSprite.position.set(PAD, textTop);

		const iconSize = this.faviconSprite.visible ? 12 : 0;
		const iconGap = iconSize > 0 ? 6 : 0;
		const meta = this.deps.textures.get(
			`bookmark:${themeRevision()}:meta:${data.domain}`,
			[{ text: data.domain, size: 10, color: theme.faint, maxLines: 1 }],
			Math.max(1, contentWidth - iconSize - iconGap),
			resolution,
		);
		// Pinned to the bottom, but never allowed to ride up over the title when the
		// card has been dragged shorter than its content.
		const metaY = Math.max(textTop + title.height + 4, this.height - PAD - meta.height + 2);
		this.metaSprite.texture = meta.texture;
		this.metaSprite.setSize(meta.width, meta.height);
		this.metaSprite.position.set(PAD + iconSize + iconGap, metaY);

		if (iconSize > 0) {
			this.faviconSprite.setSize(iconSize, iconSize);
			this.faviconSprite.position.set(PAD, metaY + (meta.height - iconSize) / 2);
		}

		this.drawChrome();
	}

	private drawChrome(): void {
		const theme = this.deps.theme();
		const zoom = this.engine.camera.zoom;
		this.chromeZoom = zoom;
		const scale = Math.max(0.2, zoom);

		const ring = this.ring;
		ring.clear();
		if (this.selected) {
			const offset = RING_OFFSET / scale;
			ring.roundRect(-offset, -offset, this.width + offset * 2, this.height + offset * 2, RADIUS + offset);
			ring.stroke({ width: 1.5 / scale, color: theme.action, alpha: 0.85 });
		}

		drawCornerHandles(this.handles, this.width, this.height, zoom, this.selected ? this.pointer : null, this.hotHandle, {
			fill: theme.card,
			ring: theme.action,
			hot: theme.action,
		});
	}
}

export function bookmarkKind(deps: BookmarkDeps): CanvasObjectKind<BookmarkObject> {
	return {
		kind: 'bookmark',
		parse: parseBookmark,
		createRenderer: (engine) => new BookmarkRenderer(engine, deps),
	};
}
