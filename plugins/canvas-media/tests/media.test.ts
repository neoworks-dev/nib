import { describe, expect, test } from 'bun:test';
import { fitSize, isMediaFile, mediaTypeFor, parseMedia } from '../src/media';

describe('mediaTypeFor', () => {
	test('maps what the server sniffed onto what the board draws', () => {
		expect(mediaTypeFor('image/png')).toBe('image');
		expect(mediaTypeFor('image/jpeg')).toBe('image');
		expect(mediaTypeFor('image/webp')).toBe('image');
		expect(mediaTypeFor('image/gif')).toBe('gif');
		expect(mediaTypeFor('video/mp4')).toBe('video');
		expect(mediaTypeFor('video/webm')).toBe('video');
		expect(mediaTypeFor('application/pdf')).toBe('pdf');
	});

	test('ignores the charset a browser tacks on', () => {
		expect(mediaTypeFor('image/png; charset=binary')).toBe('image');
		expect(mediaTypeFor('IMAGE/PNG')).toBe('image');
	});

	test('a type the board cannot draw is not media', () => {
		expect(mediaTypeFor('image/svg+xml')).toBeNull();
		expect(mediaTypeFor('text/html')).toBeNull();
		expect(mediaTypeFor('')).toBeNull();
	});

	test('isMediaFile reads the file its type claims to be', () => {
		expect(isMediaFile(new File([], 'a.png', { type: 'image/png' }))).toBe(true);
		expect(isMediaFile(new File([], 'a.txt', { type: 'text/plain' }))).toBe(false);
	});
});

describe('fitSize', () => {
	test('fits a large image into the box without distorting it', () => {
		expect(fitSize(1600, 900, 320)).toEqual({ width: 320, height: 180 });
		expect(fitSize(900, 1600, 320)).toEqual({ width: 180, height: 320 });
	});

	test('never upscales something small', () => {
		expect(fitSize(64, 48, 320)).toEqual({ width: 64, height: 48 });
	});

	test('an unmeasurable file falls back to a square', () => {
		expect(fitSize(0, 0, 320)).toEqual({ width: 320, height: 320 });
	});
});

describe('parseMedia', () => {
	const stored = { kind: 'media', id: 'm1', x: 10, y: 20, assetId: 'abc.png', mediaType: 'image' };

	test('reads back what was written', () => {
		expect(parseMedia({ ...stored, w: 200, h: 100, name: 'shot.png' })).toEqual({
			kind: 'media',
			id: 'm1',
			x: 10,
			y: 20,
			assetId: 'abc.png',
			mediaType: 'image',
			w: 200,
			h: 100,
			name: 'shot.png',
		});
	});

	test('a hand-edited board cannot produce an object without an asset or a place', () => {
		expect(parseMedia({ ...stored, assetId: '' })).toBeNull();
		expect(parseMedia({ ...stored, x: 'left' })).toBeNull();
		expect(parseMedia({ ...stored, mediaType: 'hologram' })).toBeNull();
		expect(parseMedia({ ...stored, kind: 'bookmark' })).toBeNull();
		expect(parseMedia(null)).toBeNull();
	});

	test('a size below the minimum is raised, not honoured', () => {
		expect(parseMedia({ ...stored, w: 4, h: 4 })).toMatchObject({ w: 48, h: 48 });
	});
});
