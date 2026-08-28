import { describe, expect, test } from 'bun:test';
import { latestReadPath, routeRead } from '../src/lib/client/read-routing';
import { message, session, toolResult, toolUse } from '../../../plugins/canvas/tests/fixtures';

const following = { lastRouted: null, following: true };

describe('what the agent read', () => {
	test('the newest read is the one that counts', () => {
		const view = session('s1', [
			message('a0', 'assistant', [
				toolUse('t0', 'Read', { file_path: 'src/first.ts' }),
				toolUse('t1', 'Read', { file_path: 'src/second.ts' }),
			]),
		]);

		expect(latestReadPath(view)).toBe('src/second.ts');
	});

	test('a tool the shared vocabulary does not call a read is not one', () => {
		const view = session('s1', [message('a0', 'assistant', [toolUse('t0', 'Bash', { command: 'cat src/a.ts' })])]);

		expect(latestReadPath(view)).toBeNull();
	});

	test('a tool nothing knows about at all is not one either', () => {
		const view = session('s1', [message('a0', 'assistant', [toolUse('t0', 'mcp__acme__peek', { file_path: 'a.ts' })])]);

		expect(latestReadPath(view)).toBeNull();
	});

	test('the result coming back does not make the call newer than it is', () => {
		const view = session('s1', [
			message('a0', 'assistant', [toolUse('t0', 'Read', { file_path: 'src/a.ts' })]),
			message('u0', 'user', [toolResult('t0')]),
		]);

		expect(latestReadPath(view)).toBe('src/a.ts');
	});

	test('a session that has run no tools has read nothing', () => {
		expect(latestReadPath(session('s1', []))).toBeNull();
	});
});

describe('where a read goes', () => {
	test('an attached editor gets it', () => {
		expect(routeRead({ path: 'src/a.ts', attached: ['editor'], ...following })).toEqual({
			kind: 'editor',
			path: 'src/a.ts',
		});
	});

	test('a model goes to the viewer that can turn it, not to the editor', () => {
		expect(routeRead({ path: 'art/ship.glb', attached: ['editor', 'model'], ...following })).toEqual({
			kind: 'model',
			path: 'art/ship.glb',
		});
	});

	test('a model with no viewer attached still opens in the editor that is', () => {
		expect(routeRead({ path: 'art/ship.glb', attached: ['editor'], ...following })).toEqual({
			kind: 'editor',
			path: 'art/ship.glb',
		});
	});

	test('a source file does not go to a model viewer', () => {
		expect(routeRead({ path: 'src/a.ts', attached: ['model'], ...following })).toEqual({ kind: 'none' });
	});

	test('with nothing attached, nothing happens', () => {
		expect(routeRead({ path: 'src/a.ts', attached: [], ...following })).toEqual({ kind: 'none' });
		expect(routeRead({ path: 'src/a.ts', attached: ['git', 'terminal'], ...following })).toEqual({ kind: 'none' });
	});

	test('the same path twice running is routed once', () => {
		expect(routeRead({ path: 'src/a.ts', attached: ['editor'], lastRouted: 'src/a.ts', following: true })).toEqual({
			kind: 'none',
		});
	});

	test('a path routed before is routed again once something else came between', () => {
		expect(routeRead({ path: 'src/a.ts', attached: ['editor'], lastRouted: 'src/b.ts', following: true })).toEqual({
			kind: 'editor',
			path: 'src/a.ts',
		});
	});

	test('a call that was not a read routes nothing', () => {
		expect(routeRead({ path: null, attached: ['editor'], ...following })).toEqual({ kind: 'none' });
	});

	test('nothing opens under a user who is reading an older turn', () => {
		expect(routeRead({ path: 'src/a.ts', attached: ['editor'], lastRouted: null, following: false })).toEqual({
			kind: 'none',
		});
	});
});
