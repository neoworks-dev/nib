import { Application, Container, Texture, TilingSprite } from 'pixi.js';
import type {
	ActivationGesture,
	CanvasCamera,
	CanvasEngineApi,
	CanvasObject,
	CanvasObjectRenderer,
	CanvasPointerEvent,
	CanvasTool,
	Point,
	Rect,
} from '@nib-ui/ui-contracts';
import type { Disposer } from '@nib-ui/kernel';
import type { EngineHost } from './types';
import { clampZoom, screenToWorld, worldToScreen, zoomAt } from './utils/camera';
import { pointInRect, rectsIntersect } from './utils/geometry';
import { TextTextureCache } from './utils/textTexture';

export const GRID = 16;

/** Screen pixels a right button travels before the press counts as a drag. */
const RIGHT_DRAG_THRESHOLD = 5;
/** Chrome fires the middle-button paste after the button is released. */
const MIDDLE_PASTE_GRACE_MS = 300;

export interface EngineTheme {
	background: number;
	grid: number;
	gridAlpha: number;
}

const defaultTheme: EngineTheme = { background: 0x141416, grid: 0x52525b, gridAlpha: 0.5 };

/** One grid cell with a white dot at its centre, tinted at draw time. */
function dotTexture(cell: number): Texture {
	const resolution = globalThis.devicePixelRatio || 1;
	const radius = Math.min(1.2, 0.6 + (cell / GRID) * 0.3);
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(cell * resolution));
	canvas.height = canvas.width;

	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('canvas 2d context is unavailable');
	ctx.scale(resolution, resolution);
	ctx.fillStyle = '#ffffff';
	ctx.beginPath();
	ctx.arc(cell / 2, cell / 2, radius, 0, Math.PI * 2);
	ctx.fill();

	const texture = Texture.from(canvas);
	texture.source.resolution = resolution;
	texture.source.addressMode = 'repeat';
	return texture;
}

interface RendererEntry {
	kind: string;
	renderer: CanvasObjectRenderer;
}

/**
 * Owns the Pixi application, the camera and the input plumbing. Everything it
 * draws comes from registered kinds, and every gesture it recognises is handed
 * to the active tool — it has no opinion about what a board object means.
 */
export class CanvasEngine implements CanvasEngineApi {
	app!: Application;
	/** Camera-transformed root. Layers, objects and tool overlays all live under it. */
	world!: Container;
	objectLayer!: Container;
	/** World-space scratch container for tools — rubber bands, resize handles. */
	overlay!: Container;
	readonly textures = new TextTextureCache();

	private grid!: TilingSprite;
	private readonly gridTextures = new Map<number, Texture>();
	private readonly renderers = new Map<string, RendererEntry>();
	private attachedTool: CanvasTool | null = null;
	private readonly pointers = new Map<number, Point>();
	private pinch: { distance: number; zoom: number; world: Point } | null = null;
	private middlePan: { pointerId: number; screen: Point; camera: CanvasCamera } | null = null;
	/** A right button that is down, and whether it has travelled far enough to be a drag. */
	private rightPress: { pointerId: number; screen: Point; moved: boolean } | null = null;
	private middlePanEndedAt = -Infinity;
	private disposers: Disposer[] = [];
	private lastCamera: CanvasCamera = { x: 0, y: 0, zoom: 1 };
	private lastScreen = { width: 0, height: 0 };

	constructor(
		private readonly host: EngineHost,
		private readonly theme: () => EngineTheme = () => defaultTheme,
	) {}

	/** Re-read after a light/dark switch: the canvas cannot inherit CSS variables. */
	applyTheme(): void {
		if (!this.app) return;
		this.app.renderer.background.color = this.theme().background;
		this.drawGrid();
	}

	async init(element: HTMLElement): Promise<void> {
		this.app = new Application();
		await this.app.init({
			resizeTo: element,
			background: this.theme().background,
			antialias: true,
			resolution: globalThis.devicePixelRatio || 1,
			autoDensity: true,
		});

		const canvas = this.app.canvas as HTMLCanvasElement;
		canvas.style.touchAction = 'none';
		canvas.style.display = 'block';
		element.appendChild(canvas);

		this.grid = new TilingSprite({ texture: Texture.EMPTY, eventMode: 'none' });
		this.world = new Container();
		this.world.sortableChildren = true;
		this.objectLayer = new Container();
		this.objectLayer.sortableChildren = true;
		this.overlay = new Container();
		this.overlay.zIndex = 10_000;
		this.overlay.eventMode = 'none';
		this.world.addChild(this.objectLayer, this.overlay);
		this.app.stage.addChild(this.grid, this.world);

		this.app.ticker.add(this.tick);
		this.bindInput(canvas);
		this.setTool(this.host.activeTool);
	}

	destroy(): void {
		this.attachedTool?.onDetach?.();
		this.attachedTool = null;
		for (const dispose of this.disposers.splice(0)) dispose();
		for (const entry of this.renderers.values()) entry.renderer.destroy?.();
		this.renderers.clear();
		this.textures.clear();
		for (const texture of this.gridTextures.values()) texture.destroy(true);
		this.gridTextures.clear();
		this.app?.ticker.remove(this.tick);
		this.app?.destroy(true, { children: true });
	}

	get screenWidth(): number {
		return this.app?.screen.width ?? 0;
	}

	get screenHeight(): number {
		return this.app?.screen.height ?? 0;
	}

	get camera(): CanvasCamera {
		return this.host.camera;
	}

	get objects(): CanvasObject[] {
		return this.host.objects;
	}

	get selection(): string[] {
		return this.host.selection;
	}

	addObject(object: CanvasObject): void {
		this.host.addObject(object);
	}

	updateObject(id: string, patch: Partial<CanvasObject>): void {
		this.host.updateObject(id, patch);
	}

	removeObjects(ids: string[]): void {
		this.host.removeObjects(ids);
	}

	select(ids: string[]): void {
		this.host.select(ids);
	}

	beginHistory(): Disposer {
		return this.host.beginHistory();
	}

	/** A click or double-click: what "open" means is the host's decision. */
	activate(id: string, gesture: ActivationGesture): void {
		this.host.activate(id, gesture);
	}

	connect(fromId: string, toId: string | null, at: Point): void {
		this.host.connect(fromId, toId, at);
	}

	spawn(sourceIds: string[], toId: string | null, at: Point): void {
		this.host.spawn(sourceIds, toId, at);
	}

	setTool(toolId: string): void {
		const next = this.host.tools.find((tool) => tool.id === toolId) ?? null;
		if (next === this.attachedTool) return;
		this.attachedTool?.onDetach?.();
		this.attachedTool = next;
		this.attachedTool?.onAttach?.(this);
		const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
		if (canvas) canvas.style.cursor = next?.cursor ?? '';
	}

	screenToWorld(x: number, y: number): Point {
		return screenToWorld(x, y, this.camera);
	}

	worldToScreen(x: number, y: number): Point {
		return worldToScreen(x, y, this.camera);
	}

	rendererFor(id: string): CanvasObjectRenderer | undefined {
		return this.renderers.get(id)?.renderer;
	}

	objectBounds(id: string): Rect | null {
		return this.renderers.get(id)?.renderer.bounds() ?? null;
	}

	/** Topmost object under a point in canvas-element coordinates. */
	hitTest(screenX: number, screenY: number): string | null {
		const world = this.screenToWorld(screenX, screenY);
		const objects = this.objects;

		for (let index = objects.length - 1; index >= 0; index -= 1) {
			const object = objects[index]!;
			const entry = this.renderers.get(object.id);
			if (!entry) continue;
			if (entry.renderer.hitTest) {
				if (entry.renderer.hitTest(world.x, world.y)) return object.id;
				continue;
			}
			const bounds = entry.renderer.bounds();
			const padding = this.host.kindFor(object.kind)?.hitPadding ?? 0;
			if (bounds && pointInRect(world.x, world.y, bounds, padding)) return object.id;
		}
		return null;
	}

	/** Every object whose bounds meet a world rectangle — the rubber band's job. */
	objectsIntersecting(rect: Rect): string[] {
		const ids: string[] = [];
		for (const object of this.objects) {
			const bounds = this.renderers.get(object.id)?.renderer.bounds();
			if (bounds && rectsIntersect(bounds, rect)) ids.push(object.id);
		}
		return ids;
	}

	private tick = (): void => {
		this.syncLayers();
		this.syncObjects();
		this.syncCamera();
	};

	/** Plugin layers are re-parented rather than tracked: registering one is rare. */
	private syncLayers(): void {
		for (const layer of this.host.layers) {
			if (layer.container.parent === this.world) continue;
			layer.container.zIndex = layer.order ?? 0;
			this.world.addChild(layer.container);
		}
		this.objectLayer.zIndex = 0;
	}

	private syncObjects(): void {
		const objects = this.objects;
		const live = new Set(objects.map((object) => object.id));

		for (const [id, entry] of this.renderers) {
			// A kind that was unregistered mid-session leaves its objects on the board
			// but takes its renderer with it, so the type change counts as a removal.
			if (live.has(id) && this.host.kindFor(entry.kind)) continue;
			this.renderers.delete(id);
			const renderer = entry.renderer;
			const remove = () => {
				renderer.container.parent?.removeChild(renderer.container);
				renderer.destroy?.();
			};
			if (renderer.exit) renderer.exit(remove);
			else remove();
		}

		const selection = this.selection;
		objects.forEach((object, index) => {
			const kind = this.host.kindFor(object.kind);
			if (!kind) return;
			const parsed = kind.parse(object);
			if (!parsed) return;

			let entry = this.renderers.get(object.id);
			if (!entry) {
				entry = { kind: object.kind, renderer: kind.createRenderer(this) };
				this.renderers.set(object.id, entry);
				this.objectLayer.addChild(entry.renderer.container);
				entry.renderer.spawn?.();
			}
			// Board order is z-order, so a dragged card can be brought to the front.
			entry.renderer.container.zIndex = index;
			entry.renderer.sync(parsed, selection);
		});
	}

	private syncCamera(): void {
		const { x, y, zoom } = this.camera;
		this.world.position.set(x, y);
		this.world.scale.set(zoom);

		const width = this.screenWidth;
		const height = this.screenHeight;
		const unchanged =
			x === this.lastCamera.x &&
			y === this.lastCamera.y &&
			zoom === this.lastCamera.zoom &&
			width === this.lastScreen.width &&
			height === this.lastScreen.height;
		if (unchanged) return;

		this.lastCamera = { x, y, zoom };
		this.lastScreen = { width, height };
		this.drawGrid();
	}

	/**
	 * Drawn in screen space against the camera rather than as world geometry, so
	 * the dot size stays constant and the grid never needs to cover the whole board.
	 * One tiled quad rather than a `Graphics` circle per dot: zoomed out the screen
	 * holds tens of thousands of cells, and rebuilding that geometry on every pan
	 * frame is what makes the board crawl.
	 */
	private drawGrid(): void {
		const { x, y, zoom } = this.camera;
		const step = GRID * zoom;
		this.grid.visible = step >= 6;
		if (!this.grid.visible) return;

		// The texture repeats on whole texels, so it is baked at the rounded step and
		// `tileScale` carries the fraction — otherwise the grid drifts as it wraps.
		const cell = Math.round(step);
		let texture = this.gridTextures.get(cell);
		if (!texture) {
			texture = dotTexture(cell);
			this.gridTextures.set(cell, texture);
		}

		const theme = this.theme();
		this.grid.texture = texture;
		this.grid.tint = theme.grid;
		this.grid.alpha = theme.gridAlpha;
		this.grid.width = this.screenWidth;
		this.grid.height = this.screenHeight;
		this.grid.tileScale.set(step / cell);
		// The baked dot sits at the tile centre, so the origin shifts back half a cell
		// to keep the dots on the same world coordinates the camera implies.
		this.grid.tilePosition.set(
			(((x - step / 2) % step) + step) % step,
			(((y - step / 2) % step) + step) % step,
		);
	}

	private toCanvasPoint(event: PointerEvent | WheelEvent | MouseEvent): Point {
		const rect = (this.app.canvas as HTMLCanvasElement).getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	private toolEvent(event: PointerEvent): CanvasPointerEvent {
		const screen = this.toCanvasPoint(event);
		return {
			native: event,
			screen,
			world: this.screenToWorld(screen.x, screen.y),
			button: event.button,
			shiftKey: event.shiftKey,
			metaKey: event.metaKey,
			ctrlKey: event.ctrlKey,
			altKey: event.altKey,
			pressure: event.pressure,
			pointerType: event.pointerType,
		};
	}

	private bindInput(canvas: HTMLCanvasElement): void {
		const listen = <K extends keyof HTMLElementEventMap>(
			type: K,
			handler: (event: HTMLElementEventMap[K]) => void,
			options?: AddEventListenerOptions,
		) => {
			canvas.addEventListener(type, handler as EventListener, options);
			this.disposers.push(() => canvas.removeEventListener(type, handler as EventListener, options));
		};

		// The middle button pans. On X11 it is also primary-selection paste, and on
		// every platform it is autoscroll, so the legacy mouse events have to be
		// refused as well — `pointerdown` alone does not suppress either.
		listen('mousedown', (event) => {
			if (event.button === 1) event.preventDefault();
		});
		listen('auxclick', (event) => {
			if (event.button === 1) event.preventDefault();
		});

		listen('pointerdown', (event) => {
			// A pointer the browser no longer knows cannot be captured, and it throws
			// rather than saying so. The gesture then simply runs uncaptured.
			try {
				canvas.setPointerCapture(event.pointerId);
			} catch {
				/* empty */
			}
			if (event.button === 1) {
				event.preventDefault();
				this.middlePan = {
					pointerId: event.pointerId,
					screen: this.toCanvasPoint(event),
					camera: { ...this.camera },
				};
				canvas.style.cursor = 'grabbing';
				return;
			}
			if (event.button === 2) {
				this.rightPress = { pointerId: event.pointerId, screen: this.toCanvasPoint(event), moved: false };
				this.attachedTool?.onPointerDown?.(this.toolEvent(event));
				return;
			}

			this.pointers.set(event.pointerId, this.toCanvasPoint(event));
			if (this.pointers.size === 2) {
				this.startPinch();
				return;
			}
			this.attachedTool?.onPointerDown?.(this.toolEvent(event));
		});

		listen('pointermove', (event) => {
			if (this.middlePan?.pointerId === event.pointerId) {
				const screen = this.toCanvasPoint(event);
				this.host.setCamera({
					...this.middlePan.camera,
					x: this.middlePan.camera.x + (screen.x - this.middlePan.screen.x),
					y: this.middlePan.camera.y + (screen.y - this.middlePan.screen.y),
				});
				return;
			}
			if (this.rightPress?.pointerId === event.pointerId) {
				const screen = this.toCanvasPoint(event);
				const travelled = Math.hypot(screen.x - this.rightPress.screen.x, screen.y - this.rightPress.screen.y);
				if (travelled > RIGHT_DRAG_THRESHOLD) this.rightPress.moved = true;
				this.attachedTool?.onPointerMove?.(this.toolEvent(event));
				return;
			}
			if (this.pointers.has(event.pointerId)) {
				this.pointers.set(event.pointerId, this.toCanvasPoint(event));
				if (this.pointers.size === 2) {
					this.updatePinch();
					return;
				}
			}
			this.attachedTool?.onPointerMove?.(this.toolEvent(event));
		});

		const release = (event: PointerEvent, cancelled = false) => {
			if (this.middlePan?.pointerId === event.pointerId) {
				this.middlePan = null;
				this.middlePanEndedAt = performance.now();
				canvas.style.cursor = this.attachedTool?.cursor ?? '';
				return;
			}
			if (this.rightPress?.pointerId === event.pointerId) {
				const dragged = this.rightPress.moved;
				this.rightPress = null;
				this.attachedTool?.onPointerUp?.(this.toolEvent(event));
				// A right button that never travelled is a click, and a click is the menu.
				if (!dragged && !cancelled) this.openContextMenu(this.toCanvasPoint(event));
				return;
			}
			this.pointers.delete(event.pointerId);
			this.pinch = null;
			this.attachedTool?.onPointerUp?.(this.toolEvent(event));
		};
		listen('pointerup', release);
		listen('pointercancel', (event) => release(event, true));

		listen(
			'wheel',
			(event) => {
				event.preventDefault();
				const at = this.toCanvasPoint(event);
				// Trackpad two-finger scrolling pans; pinch arrives as ctrl+wheel, and
				// a mouse wheel is only ever a zoom because the board has no scrollbars.
				if (!event.ctrlKey && !event.metaKey && event.deltaMode === 0 && Math.abs(event.deltaX) > 0) {
					this.host.setCamera({ ...this.camera, x: this.camera.x - event.deltaX, y: this.camera.y - event.deltaY });
					return;
				}
				this.host.setCamera(zoomAt(at.x, at.y, this.camera.zoom * Math.exp(-event.deltaY * 0.0015), this.camera));
			},
			{ passive: false },
		);

		// The menu is opened on release instead, because the right button also drags:
		// the native event fires on press on X11 and on release everywhere else, and
		// a gesture cannot be told from a click until the button comes back up.
		listen('contextmenu', (event) => event.preventDefault());

		listen('dblclick', (event) => {
			const screen = this.toCanvasPoint(event);
			const hitId = this.hitTest(screen.x, screen.y);
			if (hitId) this.host.activate(hitId, 'doubleClick');
		});

		// X11 pastes the primary selection on the middle button, and Chrome dispatches
		// that at whatever has focus — the drawer's composer, or the board's own paste
		// handler — however the mouse events over the canvas were answered. Panning
		// must not type, so the paste itself is refused for the length of the gesture.
		const refusePaste = (event: ClipboardEvent) => {
			if (!this.middlePan && performance.now() - this.middlePanEndedAt > MIDDLE_PASTE_GRACE_MS) return;
			event.preventDefault();
			event.stopPropagation();
		};
		window.addEventListener('paste', refusePaste, true);
		this.disposers.push(() => window.removeEventListener('paste', refusePaste, true));

		const onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
		window.addEventListener('keydown', onKeyDown);
		this.disposers.push(() => window.removeEventListener('keydown', onKeyDown));
	}

	private openContextMenu(screen: Point): void {
		const hitId = this.hitTest(screen.x, screen.y);
		const target = hitId ? (this.objects.find((object) => object.id === hitId) ?? null) : null;
		this.host.contextMenu(target, this.screenToWorld(screen.x, screen.y), screen);
	}

	/** Board shortcuts stay out of the way of the drawer's composer and any text field. */
	private handleKeyDown(event: KeyboardEvent): void {
		const active = document.activeElement as HTMLElement | null;
		if (active && active !== document.body) {
			const tag = active.tagName.toLowerCase();
			if (tag === 'input' || tag === 'textarea' || active.isContentEditable) return;
		}
		if (this.attachedTool?.onKeyDown?.(event)) return;

		const mod = event.metaKey || event.ctrlKey;
		if (mod && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) this.host.redo();
			else this.host.undo();
			return;
		}
		if (event.key === 'Escape') {
			this.host.select([]);
			return;
		}
		if (event.key === 'Backspace' || event.key === 'Delete') {
			const ids = [...this.selection];
			if (ids.length === 0) return;
			event.preventDefault();
			this.host.removeObjects(ids);
		}
	}

	private startPinch(): void {
		const [first, second] = [...this.pointers.values()];
		if (!first || !second) return;
		const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
		this.pinch = {
			distance: Math.hypot(first.x - second.x, first.y - second.y) || 1,
			zoom: this.camera.zoom,
			world: this.screenToWorld(middle.x, middle.y),
		};
	}

	private updatePinch(): void {
		if (!this.pinch) {
			this.startPinch();
			return;
		}
		const [first, second] = [...this.pointers.values()];
		if (!first || !second) return;
		const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
		const zoom = clampZoom(this.pinch.zoom * (Math.hypot(first.x - second.x, first.y - second.y) / this.pinch.distance));
		this.host.setCamera({
			zoom,
			x: middle.x - this.pinch.world.x * zoom,
			y: middle.y - this.pinch.world.y * zoom,
		});
	}
}
