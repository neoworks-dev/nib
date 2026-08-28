import { describe, expect, test } from 'bun:test';
import {
	cascadeRect,
	clampRect,
	defaultRect,
	moveRect,
	resizeRect,
	snapAt,
	snapRect,
	MIN_WINDOW_HEIGHT,
	MIN_WINDOW_WIDTH,
	type Bounds,
	type WindowRect,
} from '../src/lib/client/layout/windows';

const bounds: Bounds = { width: 1000, height: 800 };

function rect(overrides: Partial<WindowRect> = {}): WindowRect {
	return { x: 100, y: 100, width: 400, height: 300, ...overrides };
}

describe('clampRect', () => {
	test('a window that hangs off an edge is pulled back inside', () => {
		expect(clampRect(rect({ x: 900, y: 700 }), bounds)).toMatchObject({ x: 600, y: 500 });
		expect(clampRect(rect({ x: -40, y: -40 }), bounds)).toMatchObject({ x: 0, y: 0 });
	});

	test('a window is never smaller than the minimum or larger than the area', () => {
		expect(clampRect(rect({ width: 10, height: 10 }), bounds)).toMatchObject({
			width: MIN_WINDOW_WIDTH,
			height: MIN_WINDOW_HEIGHT,
		});
		expect(clampRect(rect({ width: 4000, height: 4000 }), bounds)).toMatchObject({ width: 1000, height: 800 });
	});

	test('an area smaller than the minimum keeps the window whole and at the origin', () => {
		expect(clampRect(rect(), { width: 120, height: 90 })).toEqual({
			x: 0,
			y: 0,
			width: MIN_WINDOW_WIDTH,
			height: MIN_WINDOW_HEIGHT,
		});
	});
});

describe('cascadeRect', () => {
	test('the first window sits at the default place', () => {
		expect(cascadeRect([], bounds)).toEqual(defaultRect(bounds));
	});

	test('each further window steps off the one before it', () => {
		const first = cascadeRect([], bounds);
		const second = cascadeRect([first], bounds);
		expect(second.x).toBe(first.x + 28);
		expect(second.y).toBe(first.y + 28);
	});

	test('the offset wraps instead of marching windows into the corner', () => {
		const taken = Array.from({ length: 5 }, () => rect());
		expect(cascadeRect(taken, bounds)).toEqual(defaultRect(bounds));
	});
});

describe('moveRect', () => {
	test('a drag shifts the window and stops at the edge', () => {
		expect(moveRect(rect(), 50, -30, bounds)).toMatchObject({ x: 150, y: 70, width: 400, height: 300 });
		expect(moveRect(rect(), 5000, 5000, bounds)).toMatchObject({ x: 600, y: 500 });
	});
});

describe('resizeRect', () => {
	test('the right handle only widens, the bottom handle only heightens', () => {
		expect(resizeRect(rect(), 'right', 60, 60, bounds)).toMatchObject({ width: 460, height: 300 });
		expect(resizeRect(rect(), 'bottom', 60, 60, bounds)).toMatchObject({ width: 400, height: 360 });
		expect(resizeRect(rect(), 'corner', 60, 60, bounds)).toMatchObject({ width: 460, height: 360 });
	});

	test('the top-left corner holds still, so the area caps the far edge', () => {
		const resized = resizeRect(rect(), 'corner', 5000, 5000, bounds);
		expect(resized).toMatchObject({ x: 100, y: 100, width: 900, height: 700 });
	});

	test('shrinking stops at the minimum', () => {
		expect(resizeRect(rect(), 'corner', -5000, -5000, bounds)).toMatchObject({
			width: MIN_WINDOW_WIDTH,
			height: MIN_WINDOW_HEIGHT,
		});
	});
});

describe('snapAt', () => {
	test('a pointer in the middle is not snapping to anything', () => {
		expect(snapAt(500, 400, bounds)).toBeNull();
	});

	test('each edge arms the zone it belongs to', () => {
		expect(snapAt(4, 400, bounds)).toBe('left');
		expect(snapAt(996, 400, bounds)).toBe('right');
		expect(snapAt(500, 796, bounds)).toBe('bottom');
	});

	test('the top edge is the whole area, the way every desktop does it', () => {
		expect(snapAt(500, 2, bounds)).toBe('maximize');
	});

	test('a corner wins over the two edges that meet there', () => {
		expect(snapAt(2, 2, bounds)).toBe('top-left');
		expect(snapAt(998, 2, bounds)).toBe('top-right');
		expect(snapAt(2, 798, bounds)).toBe('bottom-left');
		expect(snapAt(998, 798, bounds)).toBe('bottom-right');
	});

	test('a pointer dragged clear of the area snaps to nothing', () => {
		expect(snapAt(-200, 400, bounds)).toBeNull();
		expect(snapAt(500, 1200, bounds)).toBeNull();
	});

	test('the margin is what decides, and it is adjustable', () => {
		expect(snapAt(60, 400, bounds)).toBeNull();
		expect(snapAt(60, 400, bounds, 80)).toBe('left');
	});
});

describe('snapRect', () => {
	test('the halves tile the area between them', () => {
		const left = snapRect('left', bounds);
		const right = snapRect('right', bounds);

		expect(left).toEqual({ x: 0, y: 0, width: 500, height: 800 });
		expect(right).toEqual({ x: 500, y: 0, width: 500, height: 800 });
		expect(left.width + right.width).toBe(bounds.width);
	});

	test('a corner takes a quarter', () => {
		expect(snapRect('bottom-right', bounds)).toEqual({ x: 500, y: 400, width: 500, height: 400 });
	});

	test('maximize is the whole of it', () => {
		expect(snapRect('maximize', bounds)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
	});

	test('an area too small for a half still yields a window that fits it', () => {
		const tight: Bounds = { width: 300, height: 220 };
		const snapped = snapRect('left', tight);

		expect(snapped.width).toBeLessThanOrEqual(Math.max(tight.width, MIN_WINDOW_WIDTH));
		expect(snapped.x).toBe(0);
	});
});
