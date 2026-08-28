import type { DesktopRect, DetectedRegion } from '@nib-ui/ui-contracts';

/**
 * A capture lives in three coordinate spaces — desktop layout pixels, the capture's own
 * pixels, and board world units — and a mistake in any conversion looks like a detection
 * failure rather than a geometry bug. Every conversion is here, and nothing converts
 * inline.
 */

/** Where a capture sits on the board, and how large the bytes behind it actually are. */
export interface CapturePlacement {
	/** Board world position of the object's top-left corner. */
	x: number;
	y: number;
	/** Board world size, which the user may have resized in either axis. */
	width: number;
	height: number;
	/** The capture's intrinsic pixel size, which region rects are expressed in. */
	imageWidth: number;
	imageHeight: number;
}

export interface Point {
	x: number;
	y: number;
}

/**
 * A board point in the capture's pixel space. Returns null for a point outside the
 * object, so a click on empty board never resolves to the nearest edge pixel.
 *
 * The axes scale independently: an object dragged by one corner keeps its aspect, but
 * nothing stops a board object from being any shape, and a uniform scale would silently
 * mislocate every region once it was not.
 */
export function imagePointAt(placement: CapturePlacement, world: Point): Point | null {
	const { x, y, width, height, imageWidth, imageHeight } = placement;
	if (width <= 0 || height <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;

	const localX = world.x - x;
	const localY = world.y - y;
	if (localX < 0 || localY < 0 || localX > width || localY > height) return null;

	return { x: (localX / width) * imageWidth, y: (localY / height) * imageHeight };
}

/** The inverse, for drawing a detected region back onto the board. */
export function worldRectFor(placement: CapturePlacement, rect: DesktopRect): DesktopRect | null {
	const { imageWidth, imageHeight } = placement;
	if (imageWidth <= 0 || imageHeight <= 0) return null;

	const scaleX = placement.width / imageWidth;
	const scaleY = placement.height / imageHeight;
	return {
		x: placement.x + rect.x * scaleX,
		y: placement.y + rect.y * scaleY,
		width: rect.width * scaleX,
		height: rect.height * scaleY,
	};
}

/**
 * A rect in desktop layout coordinates, in the capture's pixel space.
 *
 * The accessibility tree answers in layout coordinates because it has never heard of the
 * capture; a capture reports the layout box it covers because the compositor told it. This
 * is where the two meet, and it is the only place they do.
 */
export function layoutToImage(
	layout: DesktopRect,
	imageWidth: number,
	imageHeight: number,
	rect: DesktopRect,
): DesktopRect | null {
	if (layout.width <= 0 || layout.height <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;
	const scaleX = imageWidth / layout.width;
	const scaleY = imageHeight / layout.height;
	return {
		x: (rect.x - layout.x) * scaleX,
		y: (rect.y - layout.y) * scaleY,
		width: rect.width * scaleX,
		height: rect.height * scaleY,
	};
}

/** The inverse, for pointing the overlay at a region found inside a picture. */
export function imageToLayout(
	layout: DesktopRect,
	imageWidth: number,
	imageHeight: number,
	rect: DesktopRect,
): DesktopRect | null {
	if (layout.width <= 0 || layout.height <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;
	const scaleX = layout.width / imageWidth;
	const scaleY = layout.height / imageHeight;
	return {
		x: layout.x + rect.x * scaleX,
		y: layout.y + rect.y * scaleY,
		width: rect.width * scaleX,
		height: rect.height * scaleY,
	};
}

/**
 * Drops a region that does not overlap the image at all. An accessibility tree answers for
 * the whole desktop, so a capture of one output picks up windows on another, and a region
 * mapped to negative coordinates would be drawn at the picture's corner.
 */
export function clipToImage(regions: readonly DetectedRegion[], imageWidth: number, imageHeight: number): DetectedRegion[] {
	const image = { x: 0, y: 0, width: imageWidth, height: imageHeight };
	return regions.filter((region) => intersectionArea(image, region.rect) > 0);
}

/** Inclusive of the left and top edges, exclusive of the right and bottom. */
export function rectContains(rect: DesktopRect, point: Point): boolean {
	if (rect.width <= 0 || rect.height <= 0) return false;
	return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

export function rectArea(rect: DesktopRect): number {
	return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function intersectionArea(left: DesktopRect, right: DesktopRect): number {
	const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
	const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
	if (width <= 0 || height <= 0) return 0;
	return width * height;
}

/**
 * The region under a point in capture pixel space. The smallest containing rect wins, so
 * a button inside a panel resolves to the button — the larger container is almost never
 * what the user meant by clicking inside it.
 */
export function regionAt(regions: readonly DetectedRegion[], point: Point): DetectedRegion | null {
	let best: DetectedRegion | null = null;
	let bestArea = Infinity;

	for (const region of regions) {
		if (!rectContains(region.rect, point)) continue;
		const area = rectArea(region.rect);
		if (area >= bestArea) continue;
		best = region;
		bestArea = area;
	}
	return best;
}

/**
 * Folds the detector results into one list. An accessibility region wins over any pixel
 * region it covers more than half of: a named region beats an unnamed one, and the pixel
 * detector finds the same button outline the accessibility tree already labelled.
 *
 * Accessibility regions never suppress each other — a real tree nests, and dropping the
 * panel because it contains a button would lose the structure `regionAt` relies on.
 */
export function mergeRegions(accessible: readonly DetectedRegion[], pixel: readonly DetectedRegion[]): DetectedRegion[] {
	const kept = pixel.filter((candidate) => {
		const area = rectArea(candidate.rect);
		if (area === 0) return false;
		return !accessible.some((region) => intersectionArea(region.rect, candidate.rect) / area > 0.5);
	});
	return [...accessible, ...kept];
}

/**
 * How a region reads inside a prompt. Coordinates travel because the harness is being
 * asked about a picture it can also see: the numbers let it name a spot the user can
 * find, and a region with no label has nothing else to identify it by.
 */
export function describeRegion(region: DetectedRegion): string {
	const { x, y, width, height } = region.rect;
	const box = `${Math.round(x)},${Math.round(y)} ${Math.round(width)}×${Math.round(height)}`;
	const name = region.label ?? region.role ?? 'unlabelled';
	return `${name} — ${box}`;
}
