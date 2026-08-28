import { describe, expect, test } from 'bun:test';
import { buildTimeline, laneOf, markIndex, rangeFromFractions, withinRange } from '../src/timeline';
import type { TraceNode } from '../src/trace';

function node(overrides: Partial<TraceNode>): TraceNode {
	return {
		id: 'n1',
		depth: 0,
		kind: 'tool',
		badge: 'TOOL',
		title: 'Bash',
		detail: '',
		result: null,
		status: 'ok',
		seq: 1,
		ts: 1_000,
		durationMs: 100,
		turn: 1,
		step: 1,
		events: [],
		...overrides,
	};
}

describe('laneOf', () => {
	test('splits input, model and tool work into lanes', () => {
		expect(laneOf(node({ kind: 'message', badge: 'USER' }))).toBe('input');
		expect(laneOf(node({ kind: 'message', badge: 'ASSISTANT' }))).toBe('model');
		expect(laneOf(node({ kind: 'thinking' }))).toBe('model');
		expect(laneOf(node({ kind: 'tool' }))).toBe('tools');
		expect(laneOf(node({ kind: 'permission' }))).toBe('tools');
	});

	test('bookkeeping events stay off the strip', () => {
		expect(laneOf(node({ kind: 'state' }))).toBeNull();
		expect(laneOf(node({ kind: 'log' }))).toBeNull();
		expect(laneOf(node({ kind: 'session' }))).toBeNull();
		expect(laneOf(node({ kind: 'other' }))).toBeNull();
	});
});

describe('buildTimeline', () => {
	test('reports the wall-clock span but lays steps out on activity time', () => {
		const timeline = buildTimeline([node({ id: 'a', ts: 1_000, durationMs: 500 }), node({ id: 'b', ts: 2_000, durationMs: 500 })]);

		expect(timeline).toMatchObject({ from: 1_000, to: 2_500 });
		expect(timeline.marks).toHaveLength(2);
		// The 500 ms idle gap collapses, so two equal steps split the axis evenly.
		expect(timeline.marks[0]!.start).toBe(0);
		expect(timeline.marks[0]!.end).toBeCloseTo(0.48, 1);
		expect(timeline.marks[1]!.end).toBeCloseTo(1);
	});

	test('a long idle stretch never dominates the axis', () => {
		const packed = buildTimeline([node({ id: 'a', ts: 0, durationMs: 100 }), node({ id: 'b', ts: 600_000, durationMs: 100 })]);

		expect(packed.marks[1]!.start).toBeLessThan(0.6);
		expect(packed.marks[1]!.end).toBeCloseTo(1);
	});

	test('orders by timestamp regardless of input order', () => {
		const timeline = buildTimeline([node({ id: 'late', ts: 5_000 }), node({ id: 'early', ts: 1_000 })]);
		expect(timeline.marks.map((mark) => mark.nodeId)).toEqual(['early', 'late']);
	});

	test('gives a zero-length step a visible width', () => {
		const [mark] = buildTimeline([node({ ts: 1_000, durationMs: 0 }), node({ id: 'z', ts: 5_000 })]).marks;
		expect(mark!.end).toBeGreaterThan(mark!.start);
	});

	test('an empty trace has an empty timeline', () => {
		expect(buildTimeline([])).toEqual({ from: 0, to: 0, marks: [] });
	});

	test('keeps a slot for lane-less steps so filtering still sees them', () => {
		const timeline = buildTimeline([
			node({ id: 'a', kind: 'state', ts: 1_000, durationMs: 0 }),
			node({ id: 'b', kind: 'tool', ts: 3_000, durationMs: 0 }),
		]);

		expect(timeline).toMatchObject({ from: 1_000, to: 3_000 });
		expect(timeline.marks.map((mark) => mark.lane)).toEqual([null, 'tools']);
	});
});

describe('range constraints', () => {
	const timeline = buildTimeline([
		node({ id: 'a', ts: 0, durationMs: 100 }),
		node({ id: 'b', ts: 200, durationMs: 100 }),
		node({ id: 'c', ts: 400, durationMs: 100 }),
	]);
	const marks = markIndex(timeline);

	test('keeps the steps whose slot overlaps the window', () => {
		const range = { from: 0, to: 0.4 };

		expect(withinRange(marks.get('a'), range)).toBe(true);
		expect(withinRange(marks.get('c'), range)).toBe(false);
		expect(withinRange(marks.get('c'), null)).toBe(true);
		expect(withinRange(undefined, range)).toBe(false);
	});

	test('a brush normalises whichever way it was dragged', () => {
		expect(rangeFromFractions(0.75, 0.25)).toEqual({ from: 0.25, to: 0.75 });
		expect(rangeFromFractions(-0.2, 1.4)).toEqual({ from: 0, to: 1 });
	});
});
