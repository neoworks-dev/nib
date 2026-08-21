import { describe, expect, test } from 'bun:test';
import { buildTimeline, fractionsOfRange, laneOf, rangeFromFractions, withinRange } from '../src/timeline';
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
	test('spans from the first step to the end of the last', () => {
		const timeline = buildTimeline([node({ id: 'a', ts: 1_000, durationMs: 500 }), node({ id: 'b', ts: 2_000, durationMs: 0 })]);
		expect(timeline.marks).toHaveLength(2);

		expect(timeline.from).toBe(1_000);
		expect(timeline.to).toBe(2_000);
		expect(timeline.marks[0]).toMatchObject({ nodeId: 'a', start: 0 });
		expect(timeline.marks[0]!.end).toBeCloseTo(0.5);
		expect(timeline.marks[1]!.start).toBeCloseTo(1);
	});

	test('gives a zero-length step a visible width', () => {
		const [mark] = buildTimeline([node({ ts: 1_000, durationMs: 0 }), node({ id: 'z', ts: 5_000 })]).marks;
		expect(mark!.end).toBeGreaterThan(mark!.start);
	});

	test('an empty trace has an empty timeline', () => {
		expect(buildTimeline([])).toEqual({ from: 0, to: 0, marks: [] });
	});

	test('spans the whole session even when only some steps have a lane', () => {
		const timeline = buildTimeline([
			node({ id: 'a', kind: 'state', ts: 1_000, durationMs: 0 }),
			node({ id: 'b', kind: 'tool', ts: 3_000, durationMs: 0 }),
		]);

		expect(timeline).toMatchObject({ from: 1_000, to: 3_000 });
		expect(timeline.marks.map((mark) => mark.nodeId)).toEqual(['b']);
		expect(timeline.marks[0]!.start).toBeCloseTo(1);
	});
});

describe('range constraints', () => {
	test('keeps steps that overlap the window', () => {
		const range = { from: 1_500, to: 2_500 };

		expect(withinRange(node({ ts: 1_000, durationMs: 600 }), range)).toBe(true);
		expect(withinRange(node({ ts: 2_400, durationMs: 0 }), range)).toBe(true);
		expect(withinRange(node({ ts: 1_000, durationMs: 100 }), range)).toBe(false);
		expect(withinRange(node({ ts: 3_000 }), range)).toBe(false);
		expect(withinRange(node({ ts: 3_000 }), null)).toBe(true);
	});

	test('converts brushed fractions to a time window and back', () => {
		const timeline = buildTimeline([node({ ts: 1_000, durationMs: 0 }), node({ id: 'b', ts: 2_000, durationMs: 0 })]);
		const range = rangeFromFractions(timeline, 0.75, 0.25);

		expect(range).toEqual({ from: 1_250, to: 1_750 });
		expect(fractionsOfRange(timeline, range)).toEqual({ start: 0.25, end: 0.75 });
	});
});
