import {
	CanvasSource,
	Container,
	Graphics,
	Sprite,
	Texture,
	type FederatedPointerEvent,
	type Point as PixiPoint,
} from 'pixi.js';
import {
	drawCornerHandles,
	ObjectRenderer,
	pointInRect,
	resizedRect,
	resizeHandleAt,
	resolutionForZoom,
	themeRevision,
	type BoardTheme,
	type ResizableRenderer,
	type ResizeAnchor,
	type ResizeHandle,
	type TextTextureCache,
} from '@nib-ui/plugin-canvas';
import { assetUrl } from '@nib-ui/plugin-canvas-media';
import type { CanvasEngineApi, CanvasObjectKind, Point, Rect } from '@nib-ui/ui-contracts';
import { ModelScene } from './ModelScene';
import {
	MODEL_DEFAULT_ORBIT,
	MODEL_DEFAULT_SIZE,
	MODEL_MIN_SIZE,
	orbitAfterDrag,
	parseModel,
	type ModelObject,
	type ModelOrbit,
} from './model';

const RADIUS = 10;
const RING_OFFSET = 3;
const PAD = 12;
/** Device pixels the offscreen buffer is never allowed to exceed on either axis. */
const MAX_BUFFER = 2048;

/**
 * The orbit grip reuses the resize gesture, which is the only pointer-down drag a
 * renderer can claim from the select tool. `e` is never returned by
 * `resizeHandleAt`, which only reports corners, so the two cannot be confused.
 */
const ORBIT_HANDLE: ResizeHandle = 'e';

export interface ModelDeps {
	textures: TextTextureCache;
	theme(): BoardTheme;
	/** A double-click on the card. Where the model opens is the plugin's business. */
	open(object: ModelObject): void;
}

/** Screen pixels per board unit, capped so a huge card does not allocate a huge buffer. */
function bufferResolution(width: number, height: number, zoom: number): number {
	let resolution = Math.max(1, Math.round(resolutionForZoom(zoom)));
	while (resolution > 1 && Math.max(width, height) * resolution > MAX_BUFFER) resolution -= 1;
	return resolution;
}

/** Bottom centre of the card, clear of the corner resize handles. */
function orbitGrip(width: number, height: number, zoom: number): { x: number; y: number; radius: number } {
	const scale = Math.max(0.2, zoom);
	const radius = 11 / scale;
	return { x: width / 2, y: height - Math.min(radius * 1.6, height / 4), radius };
}

/**
 * A 3D model dropped on the board. Three draws it into its own offscreen canvas,
 * which Pixi wraps as a texture; a frame is only ever rendered and uploaded when
 * the view actually changed, so a board of idle models costs nothing per tick.
 */
export class ModelRenderer extends ObjectRenderer<ModelObject> implements ResizableRenderer {
	readonly container = new Container();

	private readonly background = new Graphics();
	private readonly ring = new Graphics();
	private readonly handles = new Graphics();
	private readonly grip = new Graphics();
	private readonly labelSprite = new Sprite();
	private readonly sprite = new Sprite();

	private scene: ModelScene | null = null;
	private source: CanvasSource | null = null;

	private data: ModelObject | null = null;
	private width = MODEL_DEFAULT_SIZE;
	private height = MODEL_DEFAULT_SIZE;
	private orbit: ModelOrbit = MODEL_DEFAULT_ORBIT;
	private orbitFrom: ModelOrbit = MODEL_DEFAULT_ORBIT;
	private orbiting = false;
	private resizeFrom: ResizeAnchor | null = null;
	private buffer = { width: 0, height: 0, resolution: 0 };
	private dirty = false;
	private failed = false;
	private hotHandle: ResizeHandle | null = null;
	private pointer: Point | null = null;
	private selected = false;
	private loadedAssetId = '';
	private signature = '';
	private chromeZoom = 0;

	constructor(
		private readonly engine: CanvasEngineApi,
		private readonly deps: ModelDeps,
	) {
		super();
		this.container.eventMode = 'static';
		this.container.cursor = 'pointer';
		this.container.addChild(this.ring, this.background, this.sprite, this.labelSprite, this.grip, this.handles);

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

	sync(data: ModelObject, selection: string[]): void {
		this.data = data;
		this.width = Math.max(MODEL_MIN_SIZE, data.w ?? MODEL_DEFAULT_SIZE);
		this.height = Math.max(MODEL_MIN_SIZE, data.h ?? MODEL_DEFAULT_SIZE);
		this.selected = selection.includes(data.id);

		if (data.assetId !== this.loadedAssetId) {
			this.loadedAssetId = data.assetId;
			void this.load(data);
		}

		// A drag owns the view until it is committed, so the board's older orbit does
		// not fight the pointer for the frames before the write lands.
		if (!this.orbiting && this.differsFromBoard(data)) {
			this.orbit = { yaw: data.yaw, pitch: data.pitch, distance: data.distance };
			this.dirty = true;
		}

		const signature = [
			data.assetId,
			this.width,
			this.height,
			this.selected ? 1 : 0,
			this.scene?.loaded ? 1 : 0,
			this.failed ? 1 : 0,
			themeRevision(),
		].join(' ');
		if (signature !== this.signature) {
			this.signature = signature;
			this.redraw();
		}
		if (Math.abs(this.engine.camera.zoom - this.chromeZoom) > this.chromeZoom * 0.02) this.drawChrome();

		this.syncBuffer();
		if (this.dirty) this.renderFrame();

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

	handleAt(worldX: number, worldY: number): ResizeHandle | null {
		const bounds = this.bounds();
		const localX = worldX - bounds.x;
		const localY = worldY - bounds.y;
		const zoom = this.engine.camera.zoom;

		const grip = orbitGrip(this.width, this.height, zoom);
		if (Math.hypot(localX - grip.x, localY - grip.y) <= grip.radius) return ORBIT_HANDLE;
		return resizeHandleAt(localX, localY, this.width, this.height, zoom);
	}

	hoverHandle(handle: ResizeHandle | null): void {
		if (handle === this.hotHandle) return;
		this.hotHandle = handle;
		this.drawChrome();
	}

	beginResize(): void {
		const data = this.data;
		this.resizeFrom = { x: data?.x ?? 0, y: data?.y ?? 0, width: this.width, height: this.height };
		this.orbitFrom = this.orbit;
	}

	/**
	 * The grip orbits and every other handle resizes. Deltas arrive in world units,
	 * so they are scaled back to screen pixels: an orbit should feel the same at
	 * any camera zoom.
	 */
	applyResize(handle: ResizeHandle, deltaX: number, deltaY: number, modifier: boolean): void {
		const from = this.resizeFrom;
		const data = this.data;
		if (!from || !data) return;

		if (handle === ORBIT_HANDLE) {
			const zoom = this.engine.camera.zoom;
			this.orbiting = true;
			this.orbit = orbitAfterDrag(this.orbitFrom, deltaX * zoom, deltaY * zoom, modifier);
			this.dirty = true;
			return;
		}

		const next = resizedRect(from, handle, deltaX, deltaY, modifier, MODEL_MIN_SIZE);
		this.engine.updateObject(data.id, { x: next.x, y: next.y, w: next.width, h: next.height });
	}

	/** The orbit reaches the board once, on release, rather than on every frame of the drag. */
	endResize(): void {
		this.resizeFrom = null;
		if (!this.orbiting) return;
		this.orbiting = false;
		const data = this.data;
		if (data) {
			this.engine.updateObject(data.id, {
				yaw: Number(this.orbit.yaw.toFixed(4)),
				pitch: Number(this.orbit.pitch.toFixed(4)),
				distance: Number(this.orbit.distance.toFixed(4)),
			});
		}
	}

	override destroy(): void {
		this.releaseScene();
		super.destroy();
	}

	private differsFromBoard(data: ModelObject): boolean {
		return data.yaw !== this.orbit.yaw || data.pitch !== this.orbit.pitch || data.distance !== this.orbit.distance;
	}

	private releaseScene(): void {
		const texture = this.sprite.texture;
		this.sprite.texture = Texture.EMPTY;
		if (texture !== Texture.EMPTY) texture.destroy();
		this.scene?.dispose();
		this.scene = null;
		this.source?.destroy();
		this.source = null;
	}

	private async load(data: ModelObject): Promise<void> {
		this.releaseScene();
		this.failed = false;
		this.signature = '';

		const scene = new ModelScene();
		const loaded = await scene.load(assetUrl(data.assetId), data.format).catch((cause: unknown) => {
			// The card can only say that it failed; the reason has to be readable somewhere.
			console.warn(`canvas-3d: ${data.name ?? data.assetId} (${data.format}) could not be loaded`, cause);
			return false;
		});

		// The object may have been retyped or removed while the bytes were loading.
		if (!loaded || this.data?.assetId !== data.assetId) {
			scene.dispose();
			// A model that cannot be drawn keeps its card and its name, which is more
			// useful than an object that vanishes off the board.
			this.failed = this.data?.assetId === data.assetId;
			this.signature = '';
			return;
		}

		this.scene = scene;
		this.source = new CanvasSource({
			resource: scene.canvas,
			width: this.width,
			height: this.height,
			alphaMode: 'premultiply-alpha-on-upload',
		});
		this.sprite.texture = new Texture({ source: this.source });
		this.buffer = { width: 0, height: 0, resolution: 0 };
		this.signature = '';
		this.dirty = true;
	}

	/** Re-sizes the offscreen buffer when the card or the camera zoom moved it out of step. */
	private syncBuffer(): void {
		const resolution = bufferResolution(this.width, this.height, this.engine.camera.zoom);
		const buffer = this.buffer;
		if (buffer.width === this.width && buffer.height === this.height && buffer.resolution === resolution) return;

		this.buffer = { width: this.width, height: this.height, resolution };
		this.source?.resize(this.width, this.height, resolution);
		this.scene?.resize(this.width, this.height, resolution);
		this.dirty = true;
	}

	private renderFrame(): void {
		this.dirty = false;
		const scene = this.scene;
		if (!scene?.loaded || !this.source) return;
		scene.render(this.orbit);
		this.source.update();
	}

	private redraw(): void {
		const theme = this.deps.theme();
		const graphics = this.background;
		graphics.clear();
		graphics.roundRect(0, 0, this.width, this.height, RADIUS);
		graphics.fill({ color: theme.card });
		graphics.roundRect(0.5, 0.5, this.width - 1, this.height - 1, RADIUS);
		graphics.stroke({ width: 1, color: theme.border });

		this.sprite.visible = this.scene !== null;
		this.sprite.setSize(this.width, this.height);
		this.sprite.position.set(0, 0);

		this.drawLabel(theme);
		this.drawChrome();
	}

	/** Only a model that is not on screen has anything to say: the rest is the picture. */
	private drawLabel(theme: BoardTheme): void {
		const data = this.data;
		if (!data || this.scene?.loaded) {
			this.labelSprite.visible = false;
			return;
		}

		const status = this.failed ? 'could not be loaded' : 'loading…';
		const label = this.deps.textures.get(
			`model:${themeRevision()}:${data.assetId}:${status}`,
			[
				{ text: data.name ?? '3D model', size: 12, weight: 600, color: theme.text, maxLines: 1 },
				{ text: `${data.format.toUpperCase()} · ${status}`, size: 10, color: theme.dim, maxLines: 1 },
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

		this.drawGrip(theme, zoom);
		drawCornerHandles(this.handles, this.width, this.height, zoom, this.selected ? this.pointer : null, this.hotHandle, {
			fill: theme.card,
			ring: theme.action,
			hot: theme.action,
		});
	}

	/**
	 * Drawn only once the card is selected, which is also the only state the select
	 * tool offers the gesture in — an unreachable affordance would be a lie.
	 */
	private drawGrip(theme: BoardTheme, zoom: number): void {
		const graphics = this.grip;
		graphics.clear();
		if (!this.selected || !this.scene?.loaded) return;

		const scale = Math.max(0.2, zoom);
		const grip = orbitGrip(this.width, this.height, zoom);
		const hot = this.hotHandle === ORBIT_HANDLE;

		graphics.circle(grip.x, grip.y, grip.radius);
		graphics.fill({ color: theme.card, alpha: hot ? 0.98 : 0.85 });
		graphics.circle(grip.x, grip.y, grip.radius);
		graphics.stroke({ width: 1.4 / scale, color: hot ? theme.action : theme.borderStrong, alpha: 0.95 });

		// A turntable: an ellipse with an axis through it reads as "drag to spin".
		graphics.ellipse(grip.x, grip.y, grip.radius * 0.58, grip.radius * 0.26);
		graphics.stroke({ width: 1.3 / scale, color: theme.action, alpha: hot ? 1 : 0.75 });
		graphics.moveTo(grip.x, grip.y - grip.radius * 0.5);
		graphics.lineTo(grip.x, grip.y + grip.radius * 0.5);
		graphics.stroke({ width: 1.3 / scale, color: theme.action, alpha: hot ? 1 : 0.55, cap: 'round' });
	}
}

export function modelKind(deps: ModelDeps): CanvasObjectKind<ModelObject> {
	return {
		kind: 'model',
		parse: parseModel,
		createRenderer: (engine) => new ModelRenderer(engine, deps),
		activate: (object) => deps.open(object),
	};
}
