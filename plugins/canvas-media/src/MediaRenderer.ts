import {
	Assets,
	Container,
	Graphics,
	Sprite,
	Texture,
	type FederatedPointerEvent,
	type Point as PixiPoint,
} from 'pixi.js';
import { GifSprite, GifSource } from 'pixi.js/gif';
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
import { assetUrl } from './client';
import { MEDIA_MIN_SIZE, parseMedia, type MediaObject } from './media';

const RADIUS = 10;
const RING_OFFSET = 3;
const PAD = 12;

export interface MediaDeps {
	textures: TextTextureCache;
	theme(): BoardTheme;
	/** A pdf cannot be drawn, so opening it is handed back to the app. */
	openAsset(assetId: string, name: string): void;
}

/**
 * Pasted and dropped media. The bytes live in the asset store and the board
 * holds only the id, which is what makes the undo snapshot cheap.
 */
export class MediaRenderer
	extends ObjectRenderer<MediaObject>
	implements ResizableRenderer, PressableRenderer
{
	readonly container = new Container();

	private readonly background = new Graphics();
	private readonly ring = new Graphics();
	private readonly handles = new Graphics();
	private readonly overlay = new Graphics();
	private readonly labelSprite = new Sprite();
	private content: Sprite | GifSprite | null = null;
	private video: HTMLVideoElement | null = null;

	private data: MediaObject | null = null;
	private width = MEDIA_MIN_SIZE;
	private height = MEDIA_MIN_SIZE;
	private resizeFrom: { width: number; height: number } | null = null;
	private hotHandle: ResizeHandle | null = null;
	private pointer: Point | null = null;
	private selected = false;
	private loadedAssetId = '';
	private signature = '';
	private chromeZoom = 0;

	constructor(
		private readonly engine: CanvasEngineApi,
		private readonly deps: MediaDeps,
	) {
		super();
		this.container.eventMode = 'static';
		this.container.cursor = 'pointer';
		this.container.addChild(this.ring, this.background, this.overlay, this.labelSprite, this.handles);

		this.container.on('pointerleave', () => {
			this.pointer = null;
			this.hotHandle = null;
			this.drawChrome();
		});
		this.container.on('pointermove', (event: FederatedPointerEvent) => {
			this.pointer = event.getLocalPosition(this.container) as PixiPoint;
			this.drawChrome();
		});
	}

	sync(data: MediaObject, selection: string[]): void {
		this.data = data;
		this.width = Math.max(MEDIA_MIN_SIZE, data.w ?? MEDIA_MIN_SIZE);
		this.height = Math.max(MEDIA_MIN_SIZE, data.h ?? MEDIA_MIN_SIZE);
		this.selected = selection.includes(data.id);

		if (data.assetId !== this.loadedAssetId) {
			this.loadedAssetId = data.assetId;
			void this.load(data);
		}

		const signature = [data.assetId, this.width, this.height, this.selected ? 1 : 0, themeRevision()].join(' ');
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

	/** A pdf cannot be drawn, so pressing its card hands it to the app to open. */
	pressAt(worldX: number, worldY: number): boolean {
		const data = this.data;
		if (!data || data.mediaType !== 'pdf') return false;
		if (this.handleAt(worldX, worldY) || !pointInRect(worldX, worldY, this.bounds())) return false;
		this.deps.openAsset(data.assetId, data.name ?? 'document.pdf');
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

	/**
	 * Aspect is kept by default and released with shift — the opposite of a card,
	 * because a stretched picture is nearly always a mistake.
	 */
	applyResize(handle: ResizeHandle, deltaX: number, deltaY: number, freeAspect: boolean): void {
		const from = this.resizeFrom;
		const data = this.data;
		if (!from || !data) return;

		const growX = handle.includes('e') ? deltaX : handle.includes('w') ? -deltaX : 0;
		const growY = handle.startsWith('s') ? deltaY : handle.startsWith('n') ? -deltaY : 0;
		let width = Math.max(MEDIA_MIN_SIZE, from.width + growX);
		let height = Math.max(MEDIA_MIN_SIZE, from.height + growY);
		if (!freeAspect) {
			const ratio = from.height / from.width;
			height = Math.max(MEDIA_MIN_SIZE, width * ratio);
		}

		width = Math.round(width);
		height = Math.round(height);
		const x = handle.includes('w') ? data.x + (from.width - width) : data.x;
		const y = handle.startsWith('n') ? data.y + (from.height - height) : data.y;
		this.engine.updateObject(data.id, { x: Math.round(x), y: Math.round(y), w: width, h: height });
	}

	endResize(): void {
		this.resizeFrom = null;
	}

	override destroy(): void {
		this.releaseVideo();
		super.destroy();
	}

	private releaseVideo(): void {
		if (!this.video) return;
		this.video.pause();
		this.video.removeAttribute('src');
		this.video.load();
		this.video = null;
	}

	private async load(data: MediaObject): Promise<void> {
		this.releaseVideo();
		this.content?.destroy();
		this.content = null;

		const url = assetUrl(data.assetId);
		try {
			if (data.mediaType === 'gif') {
				const response = await fetch(url);
				const source = GifSource.from(await response.arrayBuffer());
				this.content = new GifSprite({ source, autoPlay: true, loop: true });
			} else if (data.mediaType === 'video') {
				const video = document.createElement('video');
				video.src = url;
				video.loop = true;
				video.muted = true;
				video.playsInline = true;
				video.autoplay = true;
				await video.play().catch(() => undefined);
				this.video = video;
				this.content = new Sprite(Texture.from(video));
			} else if (data.mediaType === 'image') {
				this.content = new Sprite((await Assets.load(url)) as Texture);
			}
		} catch {
			// A missing or unreadable asset leaves the frame and its label behind,
			// which is more useful than an object that vanishes off the board.
			this.content = null;
		}

		// The object may have been retyped or removed while the bytes were loading.
		if (!this.content || this.data?.assetId !== data.assetId) {
			this.content?.destroy();
			this.content = null;
			return;
		}
		this.container.addChildAt(this.content, this.container.getChildIndex(this.background) + 1);
		this.signature = '';
	}

	private redraw(): void {
		const theme = this.deps.theme();
		const graphics = this.background;
		graphics.clear();
		graphics.roundRect(0, 0, this.width, this.height, RADIUS);
		graphics.fill({ color: theme.cardRaised });

		if (this.content) {
			this.content.setSize(this.width, this.height);
			this.content.position.set(0, 0);
			// Masked to the frame so a rounded corner is actually rounded.
			this.content.mask = graphics;
		}

		this.drawLabel(theme);
		this.drawChrome();
	}

	/** Only a pdf has anything to say: everything else is its own picture. */
	private drawLabel(theme: BoardTheme): void {
		const data = this.data;
		this.overlay.clear();
		if (!data || data.mediaType !== 'pdf') {
			this.labelSprite.visible = false;
			return;
		}

		const label = this.deps.textures.get(
			`media:${themeRevision()}:${data.assetId}`,
			[
				{ text: data.name ?? 'Document', size: 12, weight: 600, color: theme.text, maxLines: 1 },
				{ text: 'PDF · click to open', size: 10, color: theme.dim, maxLines: 1 },
			],
			Math.max(1, this.width - PAD * 2),
			resolutionForZoom(this.engine.camera.zoom),
		);

		this.labelSprite.visible = true;
		this.labelSprite.texture = label.texture;
		this.labelSprite.setSize(label.width, label.height);
		this.labelSprite.position.set(PAD, (this.height - label.height) / 2);
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

export function mediaKind(deps: MediaDeps): CanvasObjectKind<MediaObject> {
	return {
		kind: 'media',
		parse: parseMedia,
		createRenderer: (engine) => new MediaRenderer(engine, deps),
	};
}
