import { describe, expect, test } from 'bun:test';
import { parseAgentEvent, type AnyAgentEvent } from '@nib-ui/protocol';
import { categorizeEvent, eventSummary, filterEvents, indexBlockKinds } from '../src/filter';
import { mergeDeltas } from '../src/merge-deltas';

let seq = 0;
function event(type: string, data: unknown): AnyAgentEvent {
	seq += 1;
	return parseAgentEvent({ id: `e${seq}`, sessionId: 's1', seq, ts: seq, type, data });
}

const log: AnyAgentEvent[] = [
	event('session.status', { status: 'working' }),
	event('block.started', { messageId: 'm1', blockId: 'b1', kind: 'text' }),
	event('block.delta', { blockId: 'b1', textDelta: 'hello world' }),
	event('block.started', { messageId: 'm1', blockId: 'b2', kind: 'tool_use', toolName: 'Bash' }),
	event('block.delta', { blockId: 'b2', inputJsonDelta: '{"command":"ls"}' }),
	event('permission.requested', { requestId: 'p1', toolName: 'Bash', input: {} }),
	event('log', { level: 'error', message: 'spawn failed' }),
	event('harness.telepathy', { thought: 'unknown to this build' }),
];

describe('categorizeEvent', () => {
	const kinds = indexBlockKinds(log);

	test('deltas inherit their block kind', () => {
		expect(categorizeEvent(log[2]!, kinds)).toBe('stream');
		expect(categorizeEvent(log[4]!, kinds)).toBe('tool');
	});

	test('errors win over the state category', () => {
		expect(categorizeEvent(log[6]!, kinds)).toBe('error');
		expect(categorizeEvent(event('session.status', { status: 'error', detail: 'boom' }), kinds)).toBe('error');
		expect(categorizeEvent(log[0]!, kinds)).toBe('state');
	});

	test('unknown event types stay visible as "other"', () => {
		expect(categorizeEvent(log[7]!, kinds)).toBe('other');
	});
});

describe('filterEvents', () => {
	test('no categories selected means no category filtering', () => {
		expect(filterEvents(log, { categories: [], query: '' })).toHaveLength(log.length);
	});

	test('category selection is a union', () => {
		const filtered = filterEvents(log, { categories: ['tool', 'error'], query: '' });
		expect(filtered.map((entry) => entry.type)).toEqual([
			'block.started',
			'block.delta',
			'permission.requested',
			'log',
		]);
	});

	test('search matches the payload as well as the type', () => {
		expect(filterEvents(log, { categories: [], query: 'hello world' }).map((entry) => entry.seq)).toEqual([
			log[2]!.seq,
		]);
		expect(filterEvents(log, { categories: [], query: 'permission' })).toHaveLength(1);
		expect(filterEvents(log, { categories: [], query: 'telepathy' })).toHaveLength(1);
	});

	test('search and categories combine', () => {
		expect(filterEvents(log, { categories: ['stream'], query: 'ls' })).toHaveLength(0);
	});
});

describe('eventSummary', () => {
	test('describes known events and falls back to the type', () => {
		expect(eventSummary(log[5]!)).toBe('Bash');
		expect(eventSummary(log[6]!)).toBe('spawn failed');
		expect(eventSummary(log[7]!)).toBe('harness.telepathy');
	});
});

describe('mergeDeltas', () => {
	const delta = (seq: number, blockId: string, textDelta: string): AnyAgentEvent => ({
		id: `d${seq}`,
		sessionId: 's1',
		seq,
		ts: seq,
		type: 'block.delta',
		data: { blockId, textDelta },
	});

	test('folds consecutive deltas of one block into a single row', () => {
		const rows = mergeDeltas([delta(1, 'b1', 'He'), delta(2, 'b1', 'llo'), delta(3, 'b1', '!')]);

		expect(rows).toHaveLength(1);
		expect(rows[0]!.mergedCount).toBe(3);
		expect(rows[0]!.firstSeq).toBe(1);
		expect((rows[0]!.event.data as { textDelta: string }).textDelta).toBe('Hello!');
	});

	test('breaks the run on a different block or another event type', () => {
		const rows = mergeDeltas([
			delta(1, 'b1', 'a'),
			delta(2, 'b2', 'b'),
			{ id: 'e3', sessionId: 's1', seq: 3, ts: 3, type: 'session.status', data: { status: 'idle' } },
			delta(4, 'b2', 'c'),
		]);

		expect(rows.map((row) => row.mergedCount)).toEqual([1, 1, 1, 1]);
		expect(rows.map((row) => row.event.type)).toEqual([
			'block.delta',
			'block.delta',
			'session.status',
			'block.delta',
		]);
	});

	test('leaves a log without deltas untouched', () => {
		const events: AnyAgentEvent[] = [
			{ id: 'e1', sessionId: 's1', seq: 1, ts: 1, type: 'log', data: { level: 'info', message: 'hi' } },
		];
		expect(mergeDeltas(events)).toEqual([{ event: events[0]!, mergedCount: 1, firstSeq: 1 }]);
	});
});
