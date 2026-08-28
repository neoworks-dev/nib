import { describe, expect, test } from 'bun:test';
import {
	curveBetween,
	distanceToCurve,
	edgePoint,
	pointInRect,
	pointOnCurve,
	rectFromCorners,
	rectsIntersect,
	unionRects,
} from '../src/engine/utils/geometry';

const card = { x: 10, y: 20, width: 100, height: 50 };

describe('pointInRect', () => {
	test('the edges belong to the rectangle', () => {
		expect(pointInRect(10, 20, card)).toBe(true);
		expect(pointInRect(110, 70, card)).toBe(true);
	});

	test('a point outside stays outside', () => {
		expect(pointInRect(9, 45, card)).toBe(false);
		expect(pointInRect(60, 71, card)).toBe(false);
	});

	test('padding widens the target for thin objects', () => {
		expect(pointInRect(6, 45, card)).toBe(false);
		expect(pointInRect(6, 45, card, 5)).toBe(true);
	});
});

describe('rectsIntersect', () => {
	test('overlapping rectangles intersect', () => {
		expect(rectsIntersect(card, { x: 100, y: 60, width: 40, height: 40 })).toBe(true);
	});

	test('rectangles that only touch do not', () => {
		expect(rectsIntersect(card, { x: 110, y: 20, width: 40, height: 40 })).toBe(false);
	});

	test('a rubber band of zero area selects nothing', () => {
		expect(rectsIntersect(card, { x: 50, y: 40, width: 0, height: 0 })).toBe(false);
	});
});

describe('rectFromCorners', () => {
	test('a drag up and to the left describes the same rectangle as one down and right', () => {
		const forward = rectFromCorners({ x: 10, y: 10 }, { x: 40, y: 50 });
		const backward = rectFromCorners({ x: 40, y: 50 }, { x: 10, y: 10 });

		expect(forward).toEqual({ x: 10, y: 10, width: 30, height: 40 });
		expect(backward).toEqual(forward);
	});
});

describe('unionRects', () => {
	test('covers every rectangle it is given', () => {
		expect(unionRects([card, { x: -10, y: 100, width: 20, height: 10 }])).toEqual({
			x: -10,
			y: 20,
			width: 120,
			height: 90,
		});
	});

	test('an empty board has no bounds to fit', () => {
		expect(unionRects([])).toBeNull();
	});
});

describe('edgePoint', () => {
	test('a horizontal neighbour is met on the side, not the corner', () => {
		expect(edgePoint(card, { x: 500, y: 45 })).toEqual({ x: 110, y: 45 });
	});

	test('a neighbour straight below is met on the bottom edge', () => {
		expect(edgePoint(card, { x: 60, y: 500 })).toEqual({ x: 60, y: 70 });
	});

	test('a target on the centre has no direction to leave in', () => {
		expect(edgePoint(card, { x: 60, y: 45 })).toEqual({ x: 60, y: 45 });
	});
});

describe('curveBetween', () => {
	const left = { x: 0, y: 0, width: 100, height: 60 };
	const right = { x: 400, y: 200, width: 100, height: 60 };

	test('leaves and enters horizontally, so the ends read as a connector', () => {
		const curve = curveBetween(left, right);

		expect(curve.control1.y).toBe(curve.start.y);
		expect(curve.control2.y).toBe(curve.end.y);
		expect(curve.control1.x).toBeGreaterThan(curve.start.x);
		expect(curve.control2.x).toBeLessThan(curve.end.x);
	});

	test('a card to the left bends the other way rather than doubling back', () => {
		const curve = curveBetween(right, left);

		expect(curve.control1.x).toBeLessThan(curve.start.x);
		expect(curve.control2.x).toBeGreaterThan(curve.end.x);
	});

	test('cards on top of each other still get a bend to draw', () => {
		const curve = curveBetween(left, { ...left, y: 300 });

		expect(Math.abs(curve.control1.x - curve.start.x)).toBe(40);
	});

	test('it runs from one card to the other', () => {
		const curve = curveBetween(left, right);

		expect(pointOnCurve(curve, 0)).toEqual(curve.start);
		expect(pointOnCurve(curve, 1)).toEqual(curve.end);
	});
});

describe('distanceToCurve', () => {
	const curve = curveBetween({ x: 0, y: 0, width: 100, height: 60 }, { x: 400, y: 200, width: 100, height: 60 });

	test('a point on the line is on the line', () => {
		const middle = pointOnCurve(curve, 0.5);

		expect(distanceToCurve(curve, middle.x, middle.y)).toBeLessThan(1);
	});

	test('the bend is what is pressed, not the straight line between the ends', () => {
		// A quarter along the chord: where a straight edge would run, and where an
		// S-curve that leaves horizontally does not.
		const chordQuarter = {
			x: curve.start.x + (curve.end.x - curve.start.x) * 0.25,
			y: curve.start.y + (curve.end.y - curve.start.y) * 0.25,
		};

		expect(distanceToCurve(curve, chordQuarter.x, chordQuarter.y)).toBeGreaterThan(5);
	});

	test('the far side of the board is nowhere near it', () => {
		expect(distanceToCurve(curve, 1000, 1000)).toBeGreaterThan(100);
	});
});
