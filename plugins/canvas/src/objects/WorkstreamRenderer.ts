import { Container, Graphics, Rectangle, Sprite, type FederatedPointerEvent } from 'pixi.js';
import type { SessionView } from '@nib-ui/protocol';
import type { StagedAnnotation } from '@nib-ui/plugin-chat';
import type { CanvasEngineApi, CanvasObjectKind, Point, Rect } from '@nib-ui/ui-contracts';
import { ObjectRenderer } from '../engine/ObjectRenderer';
import { drawPorts, portAnchor, portAtPoint, type ConnectableRenderer, type ConnectPort } from '../engine/ports';
import { drawCornerHandles, resizeHandleAt, type ResizableRenderer, type ResizeHandle } from '../engine/resize';
import { pointInRect } from '../engine/utils/geometry';
import {
	resolutionForZoom,
	TextTextureCache,
	type TextRun,
} from '../engine/utils/textTexture';
import { statusColor, statusWord, themeRevision, type BoardTheme } from '../theme';
import {
	CARD_MIN_HEIGHT,
	CARD_MIN_WIDTH,
	CARD_WIDTH,
	parseWorkstream,
	workstreamView,
	type WorkstreamObject,
	type WorkstreamView,
} from '../workstream';

const PAD = 14;
const RADIUS = 12;
const HEADER_HEIGHT = 26;
/** Screen pixels the selection ring sits outside the card's own border. */
const RING_OFFSET = 3;
/** Screen pixels of pointer tracking around the card, so the ports stay reachable. */
const PORT_BAND = 34;

/** What the card needs from the app: live sessions, pinned quotes, and the palette. */
export interface WorkstreamDeps {
	view(sessionId: string): SessionView | null;
	annotations(): StagedAnnotation[];
	/** Cheap stand-in for the pinned quotes, so a frame need not build the list. */
	annotationCount(): number;
	theme(): BoardTheme;
	/** What the card would launch with, so an unstarted one still names a model. */
	launchModel(workstream: WorkstreamObject): string | null;
	textures: TextTextureCache;
	/** Called when a pinned quote's `×` is pressed, so the drawer's chips stay in sync. */
	unpinAnnotation(annotationId: string): void;
	respondToPermission(sessionId: string, allow: boolean): void;
	openFile(sessionId: string, path: string): void;
}

/**
 * The board's only first-class card. Everything on it is drawn — there is no DOM
 * inside a card any more — so the interactive rows (files, the permission
 * buttons) are hit areas the renderer tests itself.
 */
export class WorkstreamRenderer
	extends ObjectRenderer<WorkstreamObject>
	implements ResizableRenderer, ConnectableRenderer
{
	readonly container = new Container();

	private readonly background = new Graphics();
	private readonly accents = new Graphics();
	private readonly ring = new Graphics();
	private readonly handles = new Graphics();
	private readonly ports = new Graphics();
	private readonly titleSprite = new Sprite();
	private readonly bodySprite = new Sprite();
	private readonly metaSprite = new Sprite();

	private data: WorkstreamObject | null = null;
	private view: WorkstreamView | null = null;
	private width = CARD_WIDTH;
	private height = CARD_MIN_HEIGHT;
	private resizeFrom: { width: number; height: number } | null = null;
	private hotHandle: ResizeHandle | null = null;
	private hotPort: ConnectPort | null = null;
	private hovering = false;
	private hoverT = 0;
	/** Pointer in card-local coordinates while it is over the card, else null. */
	private pointer: Point | null = null;
	private selected = false;
	private signature = '';
	private resolution = 1;
	/** Zoom the constant-screen-width chrome was last drawn against. */
	private chromeZoom = 0;
	/** Rows the pointer can press, in card-local coordinates. */
	private hotspots: { rect: Rect; run: () => void }[] = [];

	constructor(
		private readonly engine: CanvasEngineApi,
		private readonly deps: WorkstreamDeps,
	) {
		super();
		this.container.eventMode = 'static';
		this.container.cursor = 'pointer';
		this.container.addChild(
			this.ring,
			this.background,
			this.accents,
			this.titleSprite,
			this.bodySprite,
			this.metaSprite,
			this.handles,
			this.ports,
		);

		this.container.on('pointerleave', () => {
			this.hovering = false;
			this.pointer = null;
			this.hotHandle = null;
			this.hotPort = null;
			this.drawChrome();
		});
		// Handles and ports fade with how close the pointer is, so the card has to
		// track it. Scoped to the card rather than `globalpointermove`, which would
		// wake every card on the board on every mouse move. Local space puts the card
		// at 0,0 regardless of the container's pivot; the hit area reaches past that
		// rect (see `drawChrome`), so hovering is the card proper, not the whole band.
		this.container.on('pointermove', (event: FederatedPointerEvent) => {
			this.pointer = event.getLocalPosition(this.container);
			this.hovering = pointInRect(this.pointer.x, this.pointer.y, {
				x: 0,
				y: 0,
				width: this.width,
				height: this.height,
			});
			this.drawChrome();
		});
		this.animate(() => {
			const target = this.hovering || this.selected ? 1 : 0;
			if (Math.abs(target - this.hoverT) > 0.004) {
				this.hoverT += (target - this.hoverT) * 0.18;
				this.applyHoverScale(this.hoverT);
			}
			return false;
		});
	}

	sync(data: WorkstreamObject, selection: string[]): void {
		this.data = data;
		const session = data.sessionId ? this.deps.view(data.sessionId) : null;
		const selected = selection.includes(data.id);
		const resolution = resolutionForZoom(this.engine.camera.zoom);

		const width = Math.max(CARD_MIN_WIDTH, data.w ?? CARD_WIDTH);
		const launchModel = this.deps.launchModel(data);
		const signature = [
			data.sessionId ?? '',
			data.goal,
			launchModel ?? '',
			width,
			data.h ?? 0,
			selected ? 1 : 0,
			resolution,
			// `lastSeq` is the transcript's revision: nothing the card shows can move
			// without it moving, so it stands in for the whole session view.
			session?.lastSeq ?? -1,
			session?.status ?? '',
			session?.title ?? '',
			this.deps.annotationCount(),
			themeRevision(),
		].join(' ');

		if (signature !== this.signature) {
			this.signature = signature;
			this.view = workstreamView(data, session, this.deps.annotations(), launchModel);
			this.selected = selected;
			this.width = width;
			this.resolution = resolution;
			this.redraw();
		}

		// The ring, the handles and the ports are all drawn at a constant width on
		// screen, so a zoom change invalidates them even when nothing else moved.
		if (Math.abs(this.engine.camera.zoom - this.chromeZoom) > this.chromeZoom * 0.02) this.drawChrome();

		// Position is the top-left on the board; the container pivots on its centre so
		// the hover and spawn scaling grow from the middle of the card.
		this.container.pivot.set(this.width / 2, this.height / 2);
		this.container.position.set(data.x + this.width / 2, data.y + this.height / 2);
	}

	override bounds(): Rect {
		const data = this.data;
		return { x: data?.x ?? 0, y: data?.y ?? 0, width: this.width, height: this.height };
	}

	/** The ports hang off the edge, so they are grabbable outside the card's bounds. */
	override hitTest(worldX: number, worldY: number): boolean {
		const bounds = this.bounds();
		if (pointInRect(worldX, worldY, bounds)) return true;
		return this.pointer !== null && this.portAt(worldX, worldY) !== null;
	}

	/** A press anywhere on a row runs it; the tool only asks whether the card was hit. */
	pressAt(worldX: number, worldY: number): boolean {
		const bounds = this.bounds();
		const localX = worldX - bounds.x;
		const localY = worldY - bounds.y;
		for (const hotspot of this.hotspots) {
			if (pointInRect(localX, localY, hotspot.rect)) {
				hotspot.run();
				return true;
			}
		}
		return false;
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

	portAt(worldX: number, worldY: number): ConnectPort | null {
		const bounds = this.bounds();
		return portAtPoint(worldX - bounds.x, worldY - bounds.y, this.width, this.height, this.engine.camera.zoom);
	}

	hoverPort(port: ConnectPort | null): void {
		if (port === this.hotPort) return;
		this.hotPort = port;
		this.drawPortAffordance();
	}

	portAnchor(port: ConnectPort): Point {
		const bounds = this.bounds();
		const local = portAnchor(port, this.width, this.height);
		return { x: bounds.x + local.x, y: bounds.y + local.y };
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
		let width = Math.max(CARD_MIN_WIDTH, from.width + growX);
		let height = Math.max(CARD_MIN_HEIGHT, from.height + growY);
		if (preserveAspect) {
			const ratio = from.height / from.width;
			height = Math.max(CARD_MIN_HEIGHT, width * ratio);
		}

		// Dragging a west or north edge moves the card as well as sizing it.
		const x = handle.includes('w') ? data.x + (from.width - width) : data.x;
		const y = handle.startsWith('n') ? data.y + (from.height - height) : data.y;
		width = Math.round(width);
		height = Math.round(height);
		this.engine.updateObject(data.id, { x: Math.round(x), y: Math.round(y), w: width, h: height });
	}

	endResize(): void {
		this.resizeFrom = null;
	}

	private redraw(): void {
		const view = this.view;
		const theme = this.deps.theme();
		if (!view) return;

		const contentWidth = this.width - PAD * 2;
		const accent = statusColor(view.status, theme);

		const title = this.bake(`title:${view.id}`, [
			{ text: view.title || 'Workstream', size: 14, weight: 600, color: theme.text, maxLines: 2, lineHeight: 19 },
		], contentWidth);

		const bodyRuns: TextRun[] = [];
		if (view.goal.length > 0) {
			bodyRuns.push({ text: view.goal, size: 11.5, color: theme.muted, maxLines: 3, lineHeight: 17, gapAfter: 6 });
		}
		if (view.output.length > 0) {
			bodyRuns.push({ text: view.output, size: 11.5, color: theme.dim, maxLines: 4, lineHeight: 17 });
		}
		const body = bodyRuns.length > 0 ? this.bake(`body:${view.id}`, bodyRuns, contentWidth) : null;

		const metaLine = [
			view.turnCount > 0 ? `${view.turnCount} turn${view.turnCount === 1 ? '' : 's'}` : '',
			view.stepSummary,
			view.model ?? '',
		]
			.filter((part) => part.length > 0)
			.join(' · ');
		const meta =
			metaLine.length > 0
				? this.bake(`meta:${view.id}`, [{ text: metaLine, size: 10, color: theme.faint, maxLines: 1 }], contentWidth)
				: null;

		this.titleSprite.texture = title.texture;
		this.titleSprite.position.set(PAD, HEADER_HEIGHT);
		this.titleSprite.setSize(title.width, title.height);

		let cursorY = HEADER_HEIGHT + title.height + 8;
		if (body) {
			this.bodySprite.visible = true;
			this.bodySprite.texture = body.texture;
			this.bodySprite.position.set(PAD, cursorY);
			this.bodySprite.setSize(body.width, body.height);
			cursorY += body.height + 8;
		} else {
			this.bodySprite.visible = false;
		}

		this.hotspots = [];
		// The status chip and the rows share one graphics layer, so it is cleared once
		// here rather than by whichever of them happens to draw first.
		this.accents.clear();
		cursorY = this.drawRows(cursorY, theme);

		if (meta) {
			this.metaSprite.visible = true;
			this.metaSprite.texture = meta.texture;
			this.metaSprite.position.set(PAD, cursorY);
			this.metaSprite.setSize(meta.width, meta.height);
			cursorY += meta.height;
		} else {
			this.metaSprite.visible = false;
		}

		this.height = Math.max(CARD_MIN_HEIGHT, this.data?.h ?? Math.ceil(cursorY + PAD));
		this.drawFrame(accent, theme);
		this.drawChrome();
	}

	private drawFrame(accent: number, theme: BoardTheme): void {
		const view = this.view;
		const graphics = this.background;
		graphics.clear();
		graphics.roundRect(0, 0, this.width, this.height, RADIUS);
		graphics.fill({ color: theme.card });
		graphics.roundRect(0.5, 0.5, this.width - 1, this.height - 1, RADIUS);
		graphics.stroke({
			width: 1,
			color: view?.asking ? accent : theme.border,
			alpha: view?.asking ? 0.7 : 1,
		});

		const accents = this.accents;
		// Status is a dot and a word rather than a badge: at board zoom a badge is
		// unreadable, and the dot still reads as a colour.
		accents.circle(PAD + 3, 15, 3.5);
		accents.fill({ color: accent, alpha: view?.status === 'idle' ? 0.55 : 1 });

		const label = this.bake(
			`status:${view?.id}:${view?.status}`,
			[{ text: statusWord(view?.status ?? 'idle').toUpperCase(), size: 9, weight: 600, color: theme.faint, maxLines: 1 }],
			this.width - PAD * 2 - 14,
		);
		accents.texture(label.texture, undefined, PAD + 14, 15 - label.height / 2, label.width, label.height);
	}

	/**
	 * File chips, pinned quotes and the permission prompt. Each row registers the
	 * rectangle that answers to a press, since a Pixi card has no child buttons.
	 */
	private drawRows(startY: number, theme: BoardTheme): number {
		const view = this.view;
		const accents = this.accents;
		if (!view) return startY;

		let y = startY;
		const rowHeight = 22;
		const width = this.width - PAD * 2;

		for (const file of view.changes.slice(0, 4)) {
			const label = this.bake(
				`file:${view.id}:${file.path}:${file.added}:${file.removed}`,
				[
					{
						text: `${file.path.slice(file.path.lastIndexOf('/') + 1)}  +${file.added} −${file.removed}`,
						size: 10,
						color: theme.muted,
						maxLines: 1,
					},
				],
				width - 12,
			);
			const rowY = y;
			this.hotspots.push({
				rect: { x: PAD, y: rowY, width, height: rowHeight },
				run: () => view.sessionId && this.deps.openFile(view.sessionId, file.path),
			});
			accents.roundRect(PAD, rowY, width, rowHeight, 6);
			accents.fill({ color: theme.cardRaised });
			accents.texture(label.texture, undefined, PAD + 6, rowY + (rowHeight - label.height) / 2, label.width, label.height);
			y += rowHeight + 4;
		}

		for (const annotation of view.annotations.slice(0, 3)) {
			const label = this.bake(
				`note:${annotation.id}`,
				[{ text: annotation.note ?? annotation.text, size: 10, color: theme.dim, maxLines: 1 }],
				width - 28,
			);
			const rowY = y;
			accents.roundRect(PAD, rowY, width, rowHeight, 6);
			accents.fill({ color: theme.cardRaised, alpha: 0.7 });
			accents.texture(label.texture, undefined, PAD + 6, rowY + (rowHeight - label.height) / 2, label.width, label.height);
			// The `×` keeps routing through the drawer's unpin, not a local delete.
			const closeRect = { x: PAD + width - 20, y: rowY, width: 20, height: rowHeight };
			accents.roundRect(closeRect.x, closeRect.y, closeRect.width, closeRect.height, 6);
			accents.fill({ color: theme.border, alpha: 0.6 });
			this.hotspots.push({ rect: closeRect, run: () => this.deps.unpinAnnotation(annotation.id) });
			y += rowHeight + 4;
		}

		if (view.asking && view.sessionId) {
			const sessionId = view.sessionId;
			const buttonWidth = (width - 6) / 2;
			const allow = { x: PAD, y, width: buttonWidth, height: rowHeight };
			const deny = { x: PAD + buttonWidth + 6, y, width: buttonWidth, height: rowHeight };

			for (const [rect, color, text, behaviour] of [
				[allow, theme.green, 'Allow', true],
				[deny, theme.red, 'Deny', false],
			] as const) {
				accents.roundRect(rect.x, rect.y, rect.width, rect.height, 6);
				accents.fill({ color, alpha: 0.16 });
				const label = this.bake(
					`permission:${text}`,
					[{ text, size: 10, weight: 600, color: text === 'Allow' ? '#4ade80' : '#f87171', maxLines: 1 }],
					rect.width,
				);
				accents.texture(
					label.texture,
					undefined,
					rect.x + (rect.width - label.width) / 2,
					rect.y + (rect.height - label.height) / 2,
					label.width,
					label.height,
				);
				this.hotspots.push({
					rect,
					run: () => this.deps.respondToPermission(sessionId, behaviour),
				});
			}
			y += rowHeight + 4;
		}

		return y;
	}

	/** Everything whose width is fixed on screen rather than in world units. */
	private drawChrome(): void {
		const theme = this.deps.theme();
		const zoom = this.engine.camera.zoom;
		this.chromeZoom = zoom;
		const scale = Math.max(0.2, zoom);

		// A ring outside the card rather than a thicker border: a border that grows
		// with the selection makes the card itself look like it changed size.
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

		// The ports sit outside the card, so the pointer has to stay tracked past its
		// own rect — otherwise reaching for a button is what makes it disappear.
		const margin = PORT_BAND / scale;
		this.container.hitArea = new Rectangle(
			-margin,
			-margin,
			this.width + margin * 2,
			this.height + margin * 2,
		);
		this.drawPortAffordance();
	}

	/** Ports fade in with how close the pointer is, like the resize handles. */
	private drawPortAffordance(): void {
		const theme = this.deps.theme();
		drawPorts(this.ports, this.width, this.height, this.engine.camera.zoom, this.pointer, this.hotPort, {
			fill: 0xffffff,
			ring: theme.border,
			glyph: theme.background,
			hot: theme.action,
		});
	}

	private bake(key: string, runs: TextRun[], width: number) {
		// The palette is baked into the texture, so a theme switch has to miss the cache.
		return this.deps.textures.get(`${themeRevision()}:${key}`, runs, Math.max(1, width), this.resolution);
	}
}

export function workstreamKind(deps: WorkstreamDeps): CanvasObjectKind<WorkstreamObject> {
	return {
		kind: 'workstream',
		parse: parseWorkstream,
		createRenderer: (engine) => new WorkstreamRenderer(engine, deps),
	};
}
