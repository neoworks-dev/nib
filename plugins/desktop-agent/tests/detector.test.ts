import { describe, expect, test } from 'bun:test';
import {
	close,
	components,
	detectRegions,
	dilate,
	erode,
	greyscale,
	sobel,
	threshold,
	type Bitmap,
} from '../src/detector';

/** A flat field of one grey, which is what a screenshot with nothing on it looks like. */
function field(width: number, height: number, level = 20): Bitmap {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let index = 0; index < width * height; index += 1) {
		data[index * 4] = level;
		data[index * 4 + 1] = level;
		data[index * 4 + 2] = level;
		data[index * 4 + 3] = 255;
	}
	return { width, height, data };
}

function fill(bitmap: Bitmap, x: number, y: number, width: number, height: number, level: number): Bitmap {
	for (let row = y; row < y + height; row += 1) {
		for (let column = x; column < x + width; column += 1) {
			const offset = (row * bitmap.width + column) * 4;
			bitmap.data[offset] = level;
			bitmap.data[offset + 1] = level;
			bitmap.data[offset + 2] = level;
		}
	}
	return bitmap;
}

function mask(width: number, height: number, set: [number, number][]): Uint8Array {
	const values = new Uint8Array(width * height);
	for (const [x, y] of set) values[y * width + x] = 1;
	return values;
}

describe('greyscale', () => {
	test('weights the channels the way the eye does', () => {
		const bitmap: Bitmap = { width: 3, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]) };
		const grey = greyscale(bitmap);
		// Green reads brightest, blue darkest, whatever their numeric value.
		expect(grey[1]).toBeGreaterThan(grey[0]!);
		expect(grey[0]).toBeGreaterThan(grey[2]!);
	});
});

describe('sobel', () => {
	test('answers zero for a field with nothing in it', () => {
		const edges = sobel(greyscale(field(16, 16)), 16, 16);
		expect(edges.every((value) => value === 0)).toBe(true);
	});

	test('finds the boundary and not the interior', () => {
		const bitmap = fill(field(20, 20), 6, 6, 8, 8, 220);
		const edges = sobel(greyscale(bitmap), 20, 20);
		// A point on the edge of the block against one in the middle of it.
		expect(edges[10 * 20 + 6]).toBeGreaterThan(100);
		expect(edges[10 * 20 + 10]).toBe(0);
	});

	test('leaves the one-pixel border alone rather than reading past the image', () => {
		const edges = sobel(greyscale(fill(field(8, 8), 0, 0, 4, 4, 255)), 8, 8);
		for (let x = 0; x < 8; x += 1) expect(edges[x]).toBe(0);
	});
});

describe('morphology', () => {
	test('dilate grows a single pixel into its neighbourhood', () => {
		const grown = dilate(mask(7, 7, [[3, 3]]), 7, 7, 1);
		expect(grown[3 * 7 + 2]).toBe(1);
		expect(grown[2 * 7 + 3]).toBe(1);
		expect(grown[3 * 7 + 1]).toBe(0);
	});

	test('erode removes a pixel with nothing around it', () => {
		expect(erode(mask(7, 7, [[3, 3]]), 7, 7, 1).every((value) => value === 0)).toBe(true);
	});

	test('close joins a one-pixel gap, which is the whole reason it is here', () => {
		const gapped = mask(9, 3, [
			[2, 1],
			[4, 1],
		]);
		expect(close(gapped, 9, 3, 1)[1 * 9 + 3]).toBe(1);
	});

	test('close leaves a wide gap open', () => {
		const gapped = mask(11, 3, [
			[1, 1],
			[9, 1],
		]);
		expect(close(gapped, 11, 3, 1)[1 * 11 + 5]).toBe(0);
	});
});

describe('components', () => {
	test('two blobs are two components', () => {
		const found = components(
			mask(10, 3, [
				[1, 1],
				[2, 1],
				[7, 1],
			]),
			10,
			3,
		);
		expect(found).toHaveLength(2);
		expect(found[0]).toMatchObject({ x: 1, y: 1, width: 2, height: 1, area: 2 });
	});

	test('a diagonal touch is two components: connectivity is four-way', () => {
		expect(
			components(
				mask(5, 5, [
					[1, 1],
					[2, 2],
				]),
				5,
				5,
			),
		).toHaveLength(2);
	});

	test('an empty mask has none', () => {
		expect(components(new Uint8Array(25), 5, 5)).toEqual([]);
	});

	test('a large blob does not overflow the stack', () => {
		// Recursion would die here; the frontier is an explicit stack for this reason.
		const solid = new Uint8Array(300 * 300).fill(1);
		const found = components(solid, 300, 300);
		expect(found).toHaveLength(1);
		expect(found[0]?.area).toBe(90_000);
	});
});

describe('detectRegions', () => {
	test('finds a control drawn on a flat panel, at the right place', () => {
		const bitmap = fill(field(200, 200), 40, 50, 60, 30, 220);
		const regions = detectRegions(bitmap, { minSize: 8 });

		expect(regions.length).toBeGreaterThan(0);
		const found = regions[0]!;
		expect(found.source).toBe('pixel');
		// The close pass grows the outline by its radius, so the box is a few pixels loose.
		expect(Math.abs(found.rect.x - 40)).toBeLessThanOrEqual(6);
		expect(Math.abs(found.rect.y - 50)).toBeLessThanOrEqual(6);
		expect(Math.abs(found.rect.width - 60)).toBeLessThanOrEqual(12);
		expect(Math.abs(found.rect.height - 30)).toBeLessThanOrEqual(12);
	});

	test('a screen with nothing on it has nothing in it', () => {
		expect(detectRegions(field(64, 64))).toEqual([]);
	});

	test('an image too small to have an interior is not an error', () => {
		expect(detectRegions(field(2, 2))).toEqual([]);
		expect(detectRegions(field(1, 40))).toEqual([]);
	});

	test('two controls are two regions', () => {
		const bitmap = fill(fill(field(200, 200), 20, 20, 50, 24, 220), 20, 120, 50, 24, 220);
		expect(detectRegions(bitmap, { minSize: 8 }).length).toBeGreaterThanOrEqual(2);
	});

	test('minSize drops a glyph-sized speck', () => {
		const bitmap = fill(field(120, 120), 40, 40, 6, 6, 240);
		expect(detectRegions(bitmap, { minSize: 20 })).toEqual([]);
	});

	test('maxFraction drops the window itself', () => {
		// A block covering almost the whole image is the window, not a control in it.
		const bitmap = fill(field(120, 120), 2, 2, 116, 116, 240);
		expect(detectRegions(bitmap, { minSize: 8, maxFraction: 0.5 })).toEqual([]);
	});

	test('the limit is honoured and the ids read in the order returned', () => {
		let bitmap = field(300, 300);
		for (let row = 0; row < 6; row += 1) {
			for (let column = 0; column < 6; column += 1) {
				bitmap = fill(bitmap, 10 + column * 48, 10 + row * 48, 30, 20, 220);
			}
		}
		const regions = detectRegions(bitmap, { minSize: 8, limit: 5 });
		expect(regions).toHaveLength(5);
		expect(regions.map((region) => region.id)).toEqual(['pixel-0', 'pixel-1', 'pixel-2', 'pixel-3', 'pixel-4']);
	});

	test('confidence prefers a solid shape over a hairline', () => {
		const bitmap = fill(fill(field(200, 200), 20, 20, 60, 40, 230), 20, 120, 60, 1, 230);
		const regions = detectRegions(bitmap, { minSize: 8 });
		// The one-pixel line is either dropped by minSize or ranked below the block; what
		// must not happen is a hairline outranking a control.
		expect(regions[0]!.rect.height).toBeGreaterThan(4);
	});

	test('threshold is what decides an edge, and nothing under it survives', () => {
		const edges = sobel(greyscale(fill(field(40, 40), 10, 10, 12, 12, 40)), 40, 40);
		expect(threshold(edges, 20).some((value) => value === 1)).toBe(true);
		expect(threshold(edges, 250).every((value) => value === 0)).toBe(true);
	});
});
