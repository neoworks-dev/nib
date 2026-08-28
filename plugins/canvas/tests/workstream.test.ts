import { describe, expect, test } from 'bun:test';
import type { HarnessDescriptor } from '@nib-ui/protocol';
import {
	freeSlot,
	launchOptions,
	launchSettings,
	parseEdge,
	parseWorkstream,
	workstreamView,
	type WorkstreamObject,
} from '../src/workstream';
import { chat, message, session, text, toolUse } from './fixtures';

function card(overrides: Partial<WorkstreamObject> = {}): WorkstreamObject {
	return { kind: 'workstream', id: 'w1', goal: '', x: 0, y: 0, ...overrides };
}

describe('parseWorkstream', () => {
	test('a card without a place on the board is not a card', () => {
		expect(parseWorkstream({ kind: 'workstream', id: 'w1', goal: '' })).toBeNull();
	});

	test('an older board without a goal still loads', () => {
		expect(parseWorkstream({ kind: 'workstream', id: 'w1', x: 4, y: 5 })).toEqual(card({ x: 4, y: 5 }));
	});

	test('a size below the minimum is raised rather than rejected', () => {
		const parsed = parseWorkstream({ kind: 'workstream', id: 'w1', x: 0, y: 0, w: 10, h: 10 });

		expect(parsed!.w).toBe(200);
		expect(parsed!.h).toBe(120);
	});

	test('another kind is never read as a workstream', () => {
		expect(parseWorkstream({ kind: 'note', id: 'n', x: 0, y: 0 })).toBeNull();
	});

	test('the picks a workstream is to start with survive a round trip', () => {
		const stored = { kind: 'workstream', id: 'w1', x: 0, y: 0, harnessId: 'codex', model: 'gpt-5', permissionMode: 'plan', effort: 'high' };

		expect(parseWorkstream(stored)).toEqual(card({ harnessId: 'codex', model: 'gpt-5', permissionMode: 'plan', effort: 'high' }));
	});

	test('a pick of the wrong type is dropped rather than carried onto the card', () => {
		expect(parseWorkstream({ kind: 'workstream', id: 'w1', x: 0, y: 0, model: 7 })).toEqual(card());
	});
});

function harness(overrides: Partial<HarnessDescriptor> = {}): HarnessDescriptor {
	return {
		id: 'claude-code',
		displayName: 'Claude Code',
		capabilities: { interrupt: true, permissionModes: ['default', 'plan'], resume: true, fork: true, slashCommands: true, models: true },
		defaultPermissionMode: 'default',
		models: [{ id: 'opus' }, { id: 'sonnet' }],
		defaultModel: 'sonnet',
		...overrides,
	} as HarnessDescriptor;
}

describe('launchSettings', () => {
	test('falls back to what the harness says it starts with', () => {
		expect(launchSettings(card(), [harness()])).toEqual({
			harnessId: 'claude-code',
			model: 'sonnet',
			permissionMode: 'default',
			effort: null,
		});
	});

	test('the user pick wins over the harness default', () => {
		expect(launchSettings(card({ model: 'opus', permissionMode: 'plan', effort: 'high' }), [harness()])).toEqual({
			harnessId: 'claude-code',
			model: 'opus',
			permissionMode: 'plan',
			effort: 'high',
		});
	});

	test('resolves against the harness the card names, not the first one registered', () => {
		const codex = harness({ id: 'codex', displayName: 'Codex', defaultModel: 'gpt-5', defaultPermissionMode: 'agent' });

		expect(launchSettings(card({ harnessId: 'codex' }), [harness(), codex])).toMatchObject({
			harnessId: 'codex',
			model: 'gpt-5',
			permissionMode: 'agent',
		});
	});

	test('a card that names no harness takes the one the board already runs', () => {
		const codex = harness({ id: 'codex', defaultModel: 'gpt-5' });

		expect(launchSettings(card(), [harness(), codex], 'codex').harnessId).toBe('codex');
	});

	test('a harness with no default model offers its first', () => {
		expect(launchSettings(card(), [harness({ defaultModel: undefined })]).model).toBe('opus');
	});

	test('nothing is registered, so there is nothing to start with', () => {
		expect(launchSettings(card(), [])).toEqual({ harnessId: null, model: null, permissionMode: null, effort: null });
	});
});

describe('launchOptions', () => {
	test('carries only what was actually chosen', () => {
		expect(launchOptions({ harnessId: 'codex', model: 'gpt-5', permissionMode: null, effort: 'high' })).toEqual({
			model: 'gpt-5',
			effort: 'high',
		});
	});

	test('the harness is not an option: it selects the adapter, it is not passed to it', () => {
		expect(launchOptions({ harnessId: 'codex', model: null, permissionMode: null, effort: null })).toEqual({});
	});
});

describe('parseEdge', () => {
	test('an unknown direction falls back to a plain arrow', () => {
		expect(parseEdge({ kind: 'edge', id: 'e', fromId: 'a', toId: 'b', direction: 'sideways' })).toEqual({
			kind: 'edge',
			id: 'e',
			fromId: 'a',
			toId: 'b',
			label: '',
			direction: 'forward',
		});
	});

	test('an edge with only one end is dropped', () => {
		expect(parseEdge({ kind: 'edge', id: 'e', fromId: 'a' })).toBeNull();
	});
});

describe('workstreamView', () => {
	test('a workstream with no session is a goal that has not been started', () => {
		const view = workstreamView(card({ goal: 'port the engine\nsecond line' }), null);

		expect(view.status).toBe('unlaunched');
		expect(view.title).toBe('port the engine');
		expect(view.sessionId).toBeNull();
	});

	test('a session that is not loaded reads as detached, not as empty', () => {
		const view = workstreamView(card({ sessionId: 's', goal: 'ship it' }), null);

		expect(view.status).toBe('detached');
		expect(view.sessionId).toBe('s');
	});

	test('the title comes from the live session, never from the board', () => {
		const view = workstreamView(card({ sessionId: 's', goal: 'stale goal' }), chat('s', ['do the thing'], { title: 'Do the thing' }));

		expect(view.title).toBe('Do the thing');
		expect(view.goal).toBe('stale goal');
	});

	test('without a goal the first prompt is what the card describes', () => {
		const view = workstreamView(card({ sessionId: 's' }), chat('s', ['fix the parser']));

		expect(view.goal).toBe('fix the parser');
		expect(view.output).toBe('answer to fix the parser');
		expect(view.turnCount).toBe(1);
	});

	test('the output is the newest answer, not the whole transcript', () => {
		const view = workstreamView(card({ sessionId: 's' }), chat('s', ['first', 'second']));

		expect(view.output).toBe('answer to second');
		expect(view.turnCount).toBe(2);
	});

	test('a running turn and a pending request both show on the card', () => {
		const live = chat('s', ['go'], {
			status: 'awaiting-permission',
			pendingPermissions: [
				{ requestId: 'r1', toolName: 'Bash', input: {}, suggestions: [], raw: null } as never,
			],
		});
		const view = workstreamView(card({ sessionId: 's' }), live);

		expect(view.asking).toBe(true);
		expect(view.status).toBe('awaiting-permission');
	});

	test('steps are summarised across every turn, edits excluded', () => {
		const live = session('s', [
			message('u0', 'user', [text('t0', 'go')]),
			message('a0', 'assistant', [toolUse('b0', 'Read', { file_path: '/a.ts' }), toolUse('b1', 'Read', { file_path: '/b.ts' })]),
		]);
		const view = workstreamView(card({ sessionId: 's' }), live);

		expect(view.steps).toHaveLength(2);
		expect(view.stepSummary).toContain('2');
	});

	test('an unstarted card names the model it would launch with', () => {
		const view = workstreamView(card(), null, [], launchSettings(card(), [harness()]).model);

		expect(view.model).toBe('sonnet');
	});

	test('the pick made on the card wins over what the harness would start with', () => {
		const view = workstreamView(card({ model: 'opus' }), null, [], 'sonnet');

		expect(view.model).toBe('opus');
	});

	test('a detached card reports what it was started with, never a harness default', () => {
		expect(workstreamView(card({ sessionId: 's' }), null, [], 'sonnet').model).toBeNull();
		expect(workstreamView(card({ sessionId: 's', model: 'opus' }), null, [], 'sonnet').model).toBe('opus');
	});

	test('a live session that has not reported a model falls back to the launch record', () => {
		const live = chat('s', ['go']);
		expect(workstreamView(card({ sessionId: 's', model: 'opus' }), live, [], 'sonnet').model).toBe('opus');

		expect(workstreamView(card({ sessionId: 's', model: 'opus' }), { ...live, model: 'haiku' }, [], 'sonnet').model).toBe(
			'haiku',
		);
	});

	test('only the quotes pinned from this workstream are carried onto it', () => {
		const view = workstreamView(card({ sessionId: 's' }), chat('s', ['go']), [
			{ id: 'q1', sessionId: 's', messageId: 'a0', text: 'kept' },
			{ id: 'q2', sessionId: 'other', messageId: 'a0', text: 'not mine' },
		]);

		expect(view.annotations.map((annotation) => annotation.id)).toEqual(['q1']);
	});
});

describe('freeSlot', () => {
	test('an empty board takes the point as given', () => {
		expect(freeSlot([], { x: 40, y: 60 })).toEqual({ x: 40, y: 60 });
	});

	test('a card is not dropped on top of one already there', () => {
		const slot = freeSlot([card({ x: 40, y: 60 })], { x: 40, y: 60 });
		expect(slot).toEqual({ x: 72, y: 92 });
	});

	test('edges and other kinds do not block a slot', () => {
		const board = [{ kind: 'edge', id: 'e', fromId: 'a', toId: 'b', label: '', direction: 'forward' as const }];
		expect(freeSlot(board, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
	});
});
