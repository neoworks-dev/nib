import type { CanvasObject, CanvasRegistry } from '@nib-ui/ui-contracts';
import { Container, Graphics } from 'pixi.js';
import { parseDesktopRegions } from './objects';
import { worldRectFor } from './regions';

/**
 * Draws detected regions over the capture they were found in.
 *
 * A layer rather than an object kind: the regions are an annotation of a `media` object
 * that already draws itself, and giving them a renderer of their own would mean a second
 * object on the board to select, move and delete in step with the picture.
 *
 * The container is added to the engine's world container, so everything here is in world
 * units and the camera is already applied.
 */
export const REGIONS_LAYER_ID = 'desktop-regions';

const ACCENT = 0x60a5fa;
const SENSITIVE = 0xf87171;

/** Redraws only when the board changed, which is what makes this cheap enough per frame. */
export class RegionsLayer {
	readonly container = new Container();
	private readonly graphics = new Graphics();
	private signature = '';

	constructor(private readonly canvas: CanvasRegistry) {
		this.container.addChild(this.graphics);
		this.container.eventMode = 'none';
		this.container.zIndex = 50;
	}

	/**
	 * Called on a ticker by the engine host. The signature is the cheapest thing that
	 * changes when the drawing would: the objects' identities, their geometry and how many
	 * regions each carries.
	 */
	sync(): void {
		const drawable = this.collect();
		const signature = JSON.stringify(drawable);
		if (signature === this.signature) return;
		this.signature = signature;

		this.graphics.clear();
		for (const entry of drawable) {
			this.graphics
				.rect(entry.x, entry.y, entry.width, entry.height)
				.stroke({ width: entry.sensitive ? 2 : 1.5, color: entry.sensitive ? SENSITIVE : ACCENT, alpha: 0.9 });
			if (entry.sensitive) {
				// A redacted field is filled, not outlined: the picture already has a black
				// block there, and the marker says that the block is deliberate.
				this.graphics.rect(entry.x, entry.y, entry.width, entry.height).fill({ color: SENSITIVE, alpha: 0.18 });
			}
		}
	}

	private collect(): { x: number; y: number; width: number; height: number; sensitive: boolean }[] {
		const objects = this.canvas.objects;
		const byId = new Map<string, CanvasObject>(objects.map((object) => [object.id, object]));
		const drawn: { x: number; y: number; width: number; height: number; sensitive: boolean }[] = [];

		for (const object of objects) {
			const stored = parseDesktopRegions(object);
			if (!stored || stored.regions.length === 0) continue;

			// An orphan is skipped rather than drawn at the origin: deleting a capture must
			// not leave its regions floating in the top-left corner of the board.
			const capture = byId.get(stored.captureObjectId);
			if (!capture || capture.kind !== 'media') continue;
			const placement = placementOf(capture, stored.imageWidth, stored.imageHeight);
			if (!placement) continue;

			for (const region of stored.regions) {
				const rect = worldRectFor(placement, region.rect);
				if (!rect) continue;
				drawn.push({
					x: Math.round(rect.x * 100) / 100,
					y: Math.round(rect.y * 100) / 100,
					width: Math.round(rect.width * 100) / 100,
					height: Math.round(rect.height * 100) / 100,
					sensitive: region.sensitive === true,
				});
			}
		}
		return drawn;
	}

	destroy(): void {
		this.graphics.destroy();
		this.container.destroy();
	}
}

/**
 * Where the capture actually sits. `w`/`h` are optional on a `media` object — one that has
 * never been resized carries neither — so the intrinsic size stands in, which is what the
 * renderer falls back to as well.
 */
function placementOf(capture: CanvasObject, imageWidth: number, imageHeight: number) {
	const x = capture.x;
	const y = capture.y;
	if (typeof x !== 'number' || typeof y !== 'number') return null;
	const width = typeof capture.w === 'number' ? capture.w : imageWidth;
	const height = typeof capture.h === 'number' ? capture.h : imageHeight;
	if (width <= 0 || height <= 0) return null;
	return { x, y, width, height, imageWidth, imageHeight };
}
