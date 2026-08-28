import { describe, expect, test } from 'bun:test';
import type { CanvasObject } from '@nib-ui/ui-contracts';
import {
	parseDesktopRegions,
	parseDesktopView,
	parseRegions,
	regionsFor,
	REGIONS_KIND,
	VIEW_KIND,
	VIEW_MIN_SIZE,
} from '../src/objects';

const rect = { x: 10, y: 20, width: 30, height: 40 };

const regionsObject = {
	kind: REGIONS_KIND,
	id: 'regions-1',
	captureObjectId: 'media-1',
	imageWidth: 1920,
	imageHeight: 1080,
	detectedAt: 1_700_000_000,
	regions: [{ id: 'a', rect, source: 'atspi', confidence: 0.9, label: 'Save', role: 'push button' }],
};

const viewObject = { kind: VIEW_KIND, id: 'view-1', x: 5, y: 6, w: 800, h: 450, outputName: 'DP-1' } as const;

describe('parseDesktopRegions', () => {
	test('round-trips a full object', () => {
		expect(parseDesktopRegions(regionsObject)).toEqual({
			kind: REGIONS_KIND,
			id: 'regions-1',
			captureObjectId: 'media-1',
			imageWidth: 1920,
			imageHeight: 1080,
			detectedAt: 1_700_000_000,
			regions: [{ id: 'a', rect, source: 'atspi', confidence: 0.9, label: 'Save', role: 'push button' }],
		});
	});

	test('keeps the application identity when it is there', () => {
		const parsed = parseDesktopRegions({ ...regionsObject, application: { appId: 'blender', pid: 7 } });
		expect(parsed?.application).toEqual({
			appId: 'blender',
			atspiName: null,
			desktopEntry: null,
			title: null,
			pid: 7,
		});
	});

	test.each([
		['the wrong kind', { ...regionsObject, kind: 'media' }],
		['no id', { ...regionsObject, id: 42 }],
		['no capture to point at', { ...regionsObject, captureObjectId: '' }],
		['no intrinsic width', { ...regionsObject, imageWidth: undefined }],
		['a zero intrinsic height', { ...regionsObject, imageHeight: 0 }],
		['not an object', 'nope'],
		['null', null],
	])('refuses an object with %s', (_name, raw) => {
		expect(parseDesktopRegions(raw)).toBeNull();
	});

	test('a missing detectedAt reads as zero rather than NaN', () => {
		const { detectedAt: _dropped, ...without } = regionsObject;
		expect(parseDesktopRegions(without)?.detectedAt).toBe(0);
	});

	test('a broken region is dropped without costing the object', () => {
		const parsed = parseDesktopRegions({
			...regionsObject,
			regions: [
				{ id: 'ok', rect, source: 'pixel', confidence: 1 },
				{ id: 'bad-source', rect, source: 'guess', confidence: 1 },
				{ id: 'no-rect', source: 'pixel', confidence: 1 },
				{ rect, source: 'pixel', confidence: 1 },
			],
		});
		expect(parsed?.regions.map((region) => region.id)).toEqual(['ok']);
	});

	test('regions that are not an array read as none', () => {
		expect(parseDesktopRegions({ ...regionsObject, regions: 'lots' })?.regions).toEqual([]);
		expect(parseRegions(null)).toEqual([]);
	});
});

describe('parseDesktopView', () => {
	test('round-trips a full object', () => {
		expect(parseDesktopView(viewObject)).toEqual(viewObject);
	});

	test('clamps a size below the minimum instead of refusing the object', () => {
		const parsed = parseDesktopView({ ...viewObject, w: 4, h: 4 });
		expect(parsed).toMatchObject({ w: VIEW_MIN_SIZE, h: VIEW_MIN_SIZE });
	});

	test('a missing size falls back rather than reading as zero', () => {
		const { w: _w, h: _h, ...without } = viewObject;
		const parsed = parseDesktopView(without);
		expect(parsed?.w).toBeGreaterThanOrEqual(VIEW_MIN_SIZE);
		expect(parsed?.h).toBeGreaterThanOrEqual(VIEW_MIN_SIZE);
	});

	test.each([
		['the wrong kind', { ...viewObject, kind: REGIONS_KIND }],
		['no position', { ...viewObject, x: undefined }],
		['no output', { ...viewObject, outputName: '' }],
		['null', null],
	])('refuses an object with %s', (_name, raw) => {
		expect(parseDesktopView(raw)).toBeNull();
	});
});

describe('regionsFor', () => {
	const board: CanvasObject[] = [
		{ kind: 'media', id: 'media-1', assetId: 'a.png' },
		regionsObject as unknown as CanvasObject,
		{ ...regionsObject, id: 'regions-2', captureObjectId: 'media-2' } as unknown as CanvasObject,
	];

	test('finds the regions belonging to one capture', () => {
		expect(regionsFor(board, 'media-1')?.id).toBe('regions-1');
		expect(regionsFor(board, 'media-2')?.id).toBe('regions-2');
	});

	test('a capture with no detection yet has none', () => {
		expect(regionsFor(board, 'media-3')).toBeNull();
	});

	test('objects of other kinds are stepped over, not misread', () => {
		expect(regionsFor([{ kind: 'workstream', id: 'w1' }], 'media-1')).toBeNull();
	});
});

describe('an unloaded plugin', () => {
	/**
	 * The board reducer leaves an object whose kind nothing claims untouched, so what
	 * matters is that these objects are plain JSON: a host without this plugin loads,
	 * writes and re-serialises them without losing a field.
	 */
	test('both kinds survive a JSON round trip byte for byte', () => {
		for (const object of [regionsObject, viewObject]) {
			const serialised = JSON.stringify(object);
			expect(JSON.stringify(JSON.parse(serialised))).toBe(serialised);
		}
	});

	test('a board that made the round trip still parses on a host that has the plugin', () => {
		const survived = JSON.parse(JSON.stringify([regionsObject, viewObject])) as unknown[];
		expect(parseDesktopRegions(survived[0])).not.toBeNull();
		expect(parseDesktopView(survived[1])).not.toBeNull();
	});
});
