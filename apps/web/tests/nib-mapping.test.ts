import { describe, expect, test } from 'bun:test';
import type { EmittedEvent } from '@nib-ui/protocol';
import {
	createNibStreamState,
	mapCheckpoints,
	mapNibEvent,
	parseCommands,
	parseModels,
	queueUserAttachments,
	splitModelId,
	type NibStreamState,
} from '../src/lib/server/plugins/nib/mapping';

const baseUrl = 'http://127.0.0.1:41234';

/** Drives the reducer over a transcript the way the adapter's read loop does. */
function drain(
	events: unknown[],
	state = createNibStreamState('/repo', baseUrl, 'nib-session'),
): { state: NibStreamState; events: EmittedEvent[] } {
	const emitted: EmittedEvent[] = [];
	let current = state;
	for (const event of events) {
		const result = mapNibEvent(current, event);
		current = result.state;
		emitted.push(...result.events);
	}
	return { state: current, events: emitted };
}

function ofType<T extends EmittedEvent['type']>(events: EmittedEvent[], type: T) {
	return events.filter((event) => event.type === type) as Extract<EmittedEvent, { type: T }>[];
}

/** One complete nib turn: the model answers, calls a tool, sees the result, stops. */
const turn = [
	{ type: 'agent.message_start', seq: 2 },
	{ type: 'agent.message_delta', text: 'reading ', seq: 3 },
	{ type: 'agent.message_delta', text: 'the file', seq: 4 },
	{
		type: 'agent.message_end',
		seq: 5,
		stopReason: 'tool_use',
		content: [
			{ type: 'text', text: 'reading the file' },
			{ type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: 'src/index.ts' } },
		],
	},
	{ type: 'agent.tool_use', seq: 6, toolUseId: 'toolu_1', name: 'read', input: { path: 'src/index.ts' }, permission: 'allow' },
	{ type: 'agent.tool_result', seq: 7, toolUseId: 'toolu_1', name: 'read', content: 'export {}', isError: false },
	{ type: 'session.status_idle', seq: 8, stopReason: 'end_turn' },
];

describe('mapNibEvent', () => {
	test('echoes a user message as its own completed message', () => {
		const { events } = drain([{ type: 'user.message', seq: 1, content: [{ type: 'text', text: 'hello' }] }]);
		expect(ofType(events, 'message.started')[0]?.data).toMatchObject({ messageId: 'user-1', role: 'user' });
		expect(ofType(events, 'block.completed')[0]?.data.content).toEqual({ kind: 'text', text: 'hello' });
		expect(ofType(events, 'message.completed')).toHaveLength(1);
	});

	test('points an attached image at the blob the transcript references', () => {
		const { events } = drain([
			{ type: 'user.message', seq: 1, content: [{ type: 'image', ref: 'sha-1', mediaType: 'image/png' }] },
		]);
		expect(ofType(events, 'block.completed')[0]?.data.content).toEqual({
			kind: 'image',
			mediaType: 'image/png',
			url: `${baseUrl}/v1/sessions/nib-session/blobs/sha-1`,
		});
	});

	test('queued attachments land on the echo of the message they were sent with', () => {
		const shot = { assetId: `${'a'.repeat(64)}.png`, mime: 'image/png', name: 'shot.png' };
		const queued = queueUserAttachments(
			queueUserAttachments(createNibStreamState('/repo', baseUrl, 'nib-session'), []),
			[shot],
		);
		const { state, events } = drain(
			[
				{ type: 'user.message', seq: 1, content: [{ type: 'text', text: 'plain' }] },
				{ type: 'user.message', seq: 2, content: [{ type: 'text', text: 'with a file' }] },
			],
			queued,
		);

		const started = ofType(events, 'message.started');
		expect(started[0]?.data.attachments).toBeUndefined();
		expect(started[1]?.data.attachments).toEqual([shot]);
		expect(state.pendingAttachments).toEqual([]);
	});

	test('renders application context as a user-role message', () => {
		const { events } = drain([{ type: 'app.message', seq: 1, label: 'build', text: 'the build failed' }]);
		expect(ofType(events, 'message.started')[0]?.data).toMatchObject({ role: 'user' });
		expect(ofType(events, 'block.completed')[0]?.data.content).toEqual({ kind: 'text', text: 'the build failed' });
	});

	test('announces a streamed text block once and completes it from the assembled content', () => {
		const { events } = drain(turn);
		const started = ofType(events, 'block.started').filter((event) => event.data.kind === 'text');
		expect(started).toHaveLength(1);
		expect(ofType(events, 'block.delta').map((event) => event.data.textDelta)).toEqual(['reading ', 'the file']);
		const completed = ofType(events, 'block.completed').find((event) => event.data.blockId === 'assistant-1:text');
		expect(completed?.data.content).toEqual({ kind: 'text', text: 'reading the file' });
	});

	test('separates thinking from text', () => {
		const { events } = drain([
			{ type: 'agent.message_start', seq: 1 },
			{ type: 'agent.thinking_delta', text: 'weighing options', seq: 2 },
			{ type: 'agent.message_delta', text: 'done', seq: 3 },
		]);
		expect(ofType(events, 'block.started').map((event) => event.data.kind)).toEqual(['thinking', 'text']);
	});

	test('takes the tool call from the assembled message rather than the tool_use event', () => {
		const { events } = drain(turn);
		const call = ofType(events, 'block.completed').find((event) => event.data.blockId === 'tool-toolu_1');
		expect(call?.data.content).toEqual({
			kind: 'tool_use',
			toolName: 'read',
			toolUseId: 'toolu_1',
			input: { path: 'src/index.ts' },
		});
		expect(ofType(events, 'block.started').filter((event) => event.data.kind === 'tool_use')).toHaveLength(1);
	});

	test('keeps a tool result in the message that asked for it', () => {
		const { events } = drain(turn);
		const started = ofType(events, 'block.started').find((event) => event.data.kind === 'tool_result');
		expect(started?.data.messageId).toBe('assistant-1');
		const result = ofType(events, 'block.completed').find((event) => event.data.blockId === 'tool-toolu_1:result');
		expect(result?.data.content).toEqual({ kind: 'tool_result', toolUseId: 'toolu_1', output: 'export {}', isError: false });
	});

	test('holds the message open across the tool round trip and closes it when the turn ends', () => {
		const { events } = drain(turn);
		const completed = ofType(events, 'message.completed');
		expect(completed).toHaveLength(1);
		expect(completed[0]?.data).toMatchObject({ messageId: 'assistant-1', stopReason: 'tool_use' });
		// The result block is emitted before the message closes, which is what puts it inside the turn.
		const closeIndex = events.findIndex((event) => event.type === 'message.completed');
		const resultIndex = events.findIndex(
			(event) => event.type === 'block.completed' && event.data.blockId === 'tool-toolu_1:result',
		);
		expect(resultIndex).toBeLessThan(closeIndex);
	});

	test('asks for permission only when the call is gated', () => {
		const gated = drain([
			...turn.slice(0, 4),
			{ type: 'agent.tool_use', seq: 6, toolUseId: 'toolu_1', name: 'write', input: {}, permission: 'ask' },
		]);
		expect(ofType(gated.events, 'permission.requested')[0]?.data).toMatchObject({
			requestId: 'toolu_1',
			toolName: 'write',
		});
		expect(ofType(drain(turn).events, 'permission.requested')).toHaveLength(0);
	});

	test('reads the answer to a permission request off the transcript', () => {
		const allowed = drain([{ type: 'user.tool_confirmation', seq: 9, toolUseId: 'toolu_1', result: 'always_session' }]);
		expect(ofType(allowed.events, 'permission.resolved')[0]?.data).toMatchObject({
			requestId: 'toolu_1',
			behavior: 'allow',
			resolvedBy: 'user',
		});
		const denied = drain([{ type: 'user.tool_confirmation', seq: 9, toolUseId: 'toolu_1', result: 'deny' }]);
		expect(ofType(denied.events, 'permission.resolved')[0]?.data.behavior).toBe('deny');
	});

	test('replays edited arguments onto the call that was already drawn', () => {
		const { events } = drain([
			...turn.slice(0, 4),
			{ type: 'agent.tool_use_edited', seq: 6, toolUseId: 'toolu_1', name: 'read', input: { path: 'README.md' } },
		]);
		const edits = ofType(events, 'block.completed').filter((event) => event.data.blockId === 'tool-toolu_1');
		expect(edits).toHaveLength(2);
		expect(edits[1]?.data.content).toMatchObject({ input: { path: 'README.md' } });
	});

	test('an edit for a call that was never drawn is dropped rather than orphaned', () => {
		const { events } = drain([{ type: 'agent.tool_use_edited', seq: 6, toolUseId: 'unknown', name: 'read', input: {} }]);
		expect(events).toHaveLength(0);
	});

	test('waiting for a human is not the turn ending', () => {
		const { state, events } = drain([...turn.slice(0, 5), { type: 'session.status_idle', seq: 7, stopReason: 'requires_action' }]);
		expect(ofType(events, 'session.status').at(-1)?.data.status).toBe('awaiting-permission');
		expect(ofType(events, 'message.completed')).toHaveLength(0);
		expect(state.messageId).toBe('assistant-1');
	});

	test('an aborted turn reads as idle, an errored one as error', () => {
		const aborted = drain([{ type: 'session.status_idle', seq: 1, stopReason: 'aborted' }]);
		expect(ofType(aborted.events, 'session.status')[0]?.data).toMatchObject({ status: 'idle', detail: 'interrupted' });
		const failed = drain([{ type: 'session.status_idle', seq: 1, stopReason: 'error' }]);
		expect(ofType(failed.events, 'session.status')[0]?.data.status).toBe('error');
	});

	test('a second turn opens a message of its own', () => {
		const { state } = drain([...turn, ...turn.map((event) => ({ ...event, seq: (event.seq as number) + 10 }))]);
		expect(state.assistantMessages).toBe(2);
	});

	// nib reports a refused edit and a rejected argument replacement this way while the
	// call it describes is still pending, so it must not put the session into an error state.
	test('session.error is logged rather than treated as terminal', () => {
		const { events } = drain([{ type: 'session.error', seq: 1, message: 'edit did not match' }]);
		expect(ofType(events, 'session.status')).toHaveLength(0);
		expect(ofType(events, 'log')[0]?.data).toMatchObject({ level: 'error', message: 'edit did not match' });
	});

	test('an event this build does not know survives as an ext passthrough', () => {
		const { events } = drain([{ type: 'session.something_new', seq: 1, detail: 'x' }]);
		expect(ofType(events, 'ext')[0]?.data).toMatchObject({ ns: 'nib', type: 'session.something_new' });
	});

	test('an unreadable frame degrades to a warning instead of throwing', () => {
		const { events } = drain(['not an event']);
		expect(ofType(events, 'log')[0]?.data.level).toBe('warn');
	});
});

describe('mapCheckpoints', () => {
	const twoTurns = drain([
		{ type: 'agent.message_start', seq: 2 },
		{ type: 'agent.message_end', seq: 3, stopReason: 'tool_use', content: [] },
		{ type: 'agent.message_start', seq: 10 },
		{ type: 'agent.message_end', seq: 11, stopReason: 'end_turn', content: [] },
	]);

	test('assigns a checkpoint to the message that was open at its seq', () => {
		const { events } = mapCheckpoints(twoTurns.state, {
			checkpoints: [{ seq: 4, paths: ['a.ts'] }, { seq: 12, paths: ['b.ts'] }],
		});
		expect(events.map((event) => event.data)).toEqual([
			{ messageId: 'assistant-1', checkpointId: '4' },
			{ messageId: 'assistant-2', checkpointId: '12' },
		]);
	});

	test('announces only the earliest checkpoint of a message, since restoring it undoes the rest', () => {
		const { events } = mapCheckpoints(twoTurns.state, {
			checkpoints: [{ seq: 6 }, { seq: 4 }, { seq: 5 }],
		});
		expect(events).toHaveLength(1);
		expect(events[0]?.data).toEqual({ messageId: 'assistant-1', checkpointId: '4' });
	});

	test('does not re-announce a checkpoint on the next probe', () => {
		const first = mapCheckpoints(twoTurns.state, { checkpoints: [{ seq: 4 }] });
		const second = mapCheckpoints(first.state, { checkpoints: [{ seq: 4 }] });
		expect(second.events).toHaveLength(0);
	});

	test('a checkpoint older than every message is not attributed to one', () => {
		const { events } = mapCheckpoints(twoTurns.state, { checkpoints: [{ seq: 1 }] });
		expect(events).toHaveLength(0);
	});
});

describe('catalog parsing', () => {
	test('flattens the provider-grouped model list into pickable ids', () => {
		const models = parseModels({
			providers: [
				{ provider: 'codex', models: [{ id: 'gpt-5.5', displayName: 'GPT-5.5' }] },
				{ provider: 'anthropic', models: [{ id: 'claude-opus-5' }] },
			],
		});
		expect(models.map((model) => model.id)).toEqual(['default', 'codex/gpt-5.5', 'anthropic/claude-opus-5']);
	});

	test('a model id round trips through the composer', () => {
		expect(splitModelId('anthropic/claude-opus-5')).toEqual({ provider: 'anthropic', model: 'claude-opus-5' });
		expect(splitModelId('default')).toEqual({});
	});

	test('a model whose id carries slashes keeps them', () => {
		expect(splitModelId('openrouter/meta/llama-4')).toEqual({ provider: 'openrouter', model: 'meta/llama-4' });
	});

	test('reads slash commands and skips malformed entries', () => {
		expect(parseCommands({ commands: [{ name: 'compact', description: 'summarize' }, { description: 'no name' }] })).toEqual([
			{ name: 'compact', description: 'summarize', argumentHint: undefined },
		]);
	});
});
