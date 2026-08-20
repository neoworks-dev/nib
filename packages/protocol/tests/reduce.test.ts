import { describe, expect, test } from 'bun:test';
import {
	createSessionView,
	parseAgentEvent,
	reduceSession,
	reduceSessionAll,
	safeParseAgentEvent,
	sessionCommandSchema,
	type AnyAgentEvent,
	type SessionView,
} from '@nib-ui/protocol';

const fixturePath = new URL('./fixtures/claude-session.jsonl', import.meta.url).pathname;

async function loadFixture(): Promise<AnyAgentEvent[]> {
	const text = await Bun.file(fixturePath).text();
	return text
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map((line) => parseAgentEvent(JSON.parse(line)));
}

function project(events: AnyAgentEvent[]): SessionView {
	return reduceSessionAll(createSessionView('s1'), events);
}

describe('reduceSession over a recorded stream', () => {
	test('projects messages, blocks, usage and status', async () => {
		const view = project(await loadFixture());

		expect(view.harnessId).toBe('claude-code');
		expect(view.cwd).toBe('/tmp/demo');
		expect(view.nativeSessionId).toBe('native-1');
		expect(view.capabilities?.interrupt).toBe(true);
		expect(view.status).toBe('idle');
		expect(view.messages.map((message) => message.id)).toEqual(['m1', 'm2']);

		const [assistant, user] = view.messages;
		expect(assistant!.role).toBe('assistant');
		expect(assistant!.completed).toBe(true);
		expect(assistant!.stopReason).toBe('tool_use');
		expect(assistant!.blocks.map((block) => block.kind)).toEqual(['text', 'tool_use']);
		expect(assistant!.blocks[0]!.text).toBe('Listing files.');
		expect(assistant!.blocks[1]!.toolName).toBe('Bash');
		expect(assistant!.blocks[1]!.inputJson).toBe('{"command":"ls -la"}');
		expect(assistant!.blocks[1]!.content).toEqual({
			kind: 'tool_use',
			toolName: 'Bash',
			toolUseId: 'tu-1',
			input: { command: 'ls -la' },
		});
		expect(user!.blocks[0]!.kind).toBe('tool_result');

		expect(view.usage).toEqual({ inputTokens: 1200, outputTokens: 340, cacheReadTokens: 900, costUsd: 0.0123 });
		expect(view.logs).toEqual([{ level: 'info', message: 'turn complete', ts: 1022 }]);
		expect(view.lastSeq).toBe(24);
	});

	test('permission requests are pending until resolved', async () => {
		const events = await loadFixture();
		const beforeResolution = project(events.slice(0, 14));
		expect(beforeResolution.pendingPermissions).toEqual([
			{ requestId: 'p1', toolName: 'Bash', input: { command: 'ls -la' }, suggestions: [] },
		]);

		const afterResolution = project(events);
		expect(afterResolution.pendingPermissions).toEqual([]);
		expect(afterResolution.resolvedPermissions).toEqual([
			{ requestId: 'p1', behavior: 'allow', resolvedBy: 'user' },
		]);
	});

	test('unknown event types and ext events are preserved, not fatal', async () => {
		const view = project(await loadFixture());
		expect(view.unhandled.map((event) => event.type)).toEqual(['harness.telepathy', 'ext']);
		expect(view.unhandled[1]!.raw).toEqual({ type: 'system', subtype: 'compact_boundary' });
	});

	test('replaying the stream twice is idempotent', async () => {
		const events = await loadFixture();
		const once = project(events);
		const twice = reduceSessionAll(once, events);
		expect(twice).toEqual(once);
	});

	test('the reducer does not mutate the previous state', async () => {
		const events = await loadFixture();
		const initial = createSessionView('s1');
		const snapshot = structuredClone(initial);
		reduceSessionAll(initial, events);
		expect(initial).toEqual(snapshot);
	});
});

describe('tolerance', () => {
	function event(seq: number, type: string, data: unknown): AnyAgentEvent {
		return parseAgentEvent({ id: `e${seq}`, sessionId: 's1', seq, ts: seq, type, data });
	}

	test('deltas arriving before block.started are buffered and merged', () => {
		const view = project([
			event(1, 'message.started', { messageId: 'm1', role: 'assistant' }),
			event(2, 'block.delta', { blockId: 'b1', textDelta: 'early ' }),
			event(3, 'block.delta', { blockId: 'b1', textDelta: 'bird' }),
			event(4, 'block.started', { messageId: 'm1', blockId: 'b1', kind: 'text' }),
			event(5, 'block.delta', { blockId: 'b1', textDelta: '!' }),
		]);

		expect(view.messages[0]!.blocks[0]!.text).toBe('early bird!');
		expect(view.orphanBlocks).toEqual({});
	});

	test('block.completed before block.started still wins over deltas', () => {
		const view = project([
			event(1, 'block.completed', { blockId: 'b1', content: { kind: 'text', text: 'final' } }),
			event(2, 'block.delta', { blockId: 'b1', textDelta: 'stale' }),
			event(3, 'block.started', { messageId: 'm1', blockId: 'b1', kind: 'text' }),
		]);

		const block = view.messages[0]!.blocks[0]!;
		expect(block.text).toBe('final');
		expect(block.completed).toBe(true);
		expect(view.messages[0]!.role).toBe('assistant');
	});

	test('deltas after completion do not overwrite the completed content', () => {
		const view = project([
			event(1, 'block.started', { messageId: 'm1', blockId: 'b1', kind: 'text' }),
			event(2, 'block.completed', { blockId: 'b1', content: { kind: 'text', text: 'done' } }),
			event(3, 'block.delta', { blockId: 'b1', textDelta: ' late' }),
		]);
		expect(view.messages[0]!.blocks[0]!.text).toBe('done');
	});

	test('unknown block kinds and unknown content shapes survive', () => {
		const view = project([
			event(1, 'block.started', { messageId: 'm1', blockId: 'b1', kind: 'hologram' }),
			event(2, 'block.completed', { blockId: 'b1', content: { kind: 'hologram', frames: 12 } }),
		]);

		const block = view.messages[0]!.blocks[0]!;
		expect(block.kind).toBe('hologram');
		expect(block.content).toEqual({ kind: 'hologram', frames: 12 });
	});

	test('events at or below lastSeq are ignored', () => {
		const first = reduceSession(createSessionView('s1'), event(5, 'session.status', { status: 'working' }));
		const replayed = reduceSession(first, event(5, 'session.status', { status: 'error' }));
		expect(replayed).toBe(first);
		expect(replayed.status).toBe('working');
	});

	test('a known event type with malformed data fails to parse rather than corrupting state', () => {
		expect(safeParseAgentEvent({ id: 'x', sessionId: 's1', seq: 1, ts: 1, type: 'usage.updated', data: {} })).toBeNull();
		expect(
			safeParseAgentEvent({ id: 'x', sessionId: 's1', seq: 1, ts: 1, type: 'totally.made.up', data: { a: 1 } }),
		).not.toBeNull();
	});

	test('duplicate permission requests are idempotent', () => {
		const view = project([
			event(1, 'permission.requested', { requestId: 'p1', toolName: 'Bash', input: {} }),
			event(2, 'permission.requested', { requestId: 'p1', toolName: 'Bash', input: {} }),
		]);
		expect(view.pendingPermissions).toHaveLength(1);
	});
});

describe('commands', () => {
	test('valid commands parse and unknown ones are rejected', () => {
		expect(sessionCommandSchema.parse({ type: 'session.send', text: 'hi' })).toEqual({
			type: 'session.send',
			text: 'hi',
		});
		expect(
			sessionCommandSchema.parse({ type: 'session.permission.respond', requestId: 'p1', behavior: 'deny' }),
		).toMatchObject({ behavior: 'deny' });
		expect(sessionCommandSchema.safeParse({ type: 'session.explode' }).success).toBe(false);
		expect(sessionCommandSchema.safeParse({ type: 'session.setPermissionMode' }).success).toBe(false);
	});
});
