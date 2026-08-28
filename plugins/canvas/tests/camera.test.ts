import { describe, expect, test } from 'bun:test';
import {
	cameraFitting,
	clampZoom,
	MAX_ZOOM,
	MIN_ZOOM,
	screenToWorld,
	worldToScreen,
	zoomAt,
} from '../src/engine/utils/camera';

const camera = { x: -120, y: 64, zoom: 1.75 };

describe('screenToWorld / worldToScreen', () => {
	test('round-trips a point through the camera', () => {
		const world = screenToWorld(430, 210, camera);
		const back = worldToScreen(world.x, world.y, camera);

		expect(back.x).toBeCloseTo(430, 10);
		expect(back.y).toBeCloseTo(210, 10);
	});

	test('the camera origin is the world origin', () => {
		expect(worldToScreen(0, 0, camera)).toEqual({ x: -120, y: 64 });
	});
});

describe('clampZoom', () => {
	test('holds the zoom inside the usable range', () => {
		expect(clampZoom(0.001)).toBe(MIN_ZOOM);
		expect(clampZoom(50)).toBe(MAX_ZOOM);
		expect(clampZoom(1.4)).toBe(1.4);
	});

	test('a broken zoom falls back to 1:1 rather than blanking the board', () => {
		expect(clampZoom(Number.NaN)).toBe(1);
	});
});

describe('zoomAt', () => {
	test('keeps whatever is under the pointer under the pointer', () => {
		const before = screenToWorld(300, 180, camera);
		const next = zoomAt(300, 180, camera.zoom * 2.3, camera);
		const after = screenToWorld(300, 180, next);

		expect(after.x).toBeCloseTo(before.x, 8);
		expect(after.y).toBeCloseTo(before.y, 8);
	});

	test('clamps, and still anchors the pointer at the clamped zoom', () => {
		const before = screenToWorld(300, 180, camera);
		const next = zoomAt(300, 180, 1000, camera);

		expect(next.zoom).toBe(MAX_ZOOM);
		expect(screenToWorld(300, 180, next).x).toBeCloseTo(before.x, 8);
	});

	test('does not mutate the camera it was given', () => {
		zoomAt(10, 10, 3, camera);
		expect(camera).toEqual({ x: -120, y: 64, zoom: 1.75 });
	});
});

describe('cameraFitting', () => {
	test('centres the content and never zooms past 1:1', () => {
		const fitted = cameraFitting({ x: 0, y: 0, width: 100, height: 100 }, 1000, 1000, 0);

		expect(fitted.zoom).toBe(1);
		expect(fitted.x).toBe(450);
		expect(fitted.y).toBe(450);
	});

	test('shrinks to fit content larger than the pane', () => {
		const fitted = cameraFitting({ x: 0, y: 0, width: 2000, height: 500 }, 1000, 1000, 0);

		expect(fitted.zoom).toBe(0.5);
		expect(fitted.x).toBe(0);
	});

	test('an empty viewport leaves the camera at the origin', () => {
		expect(cameraFitting({ x: 0, y: 0, width: 100, height: 100 }, 0, 0)).toEqual({ x: 0, y: 0, zoom: 1 });
	});
});
