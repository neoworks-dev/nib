import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createContext } from '@nib-ui/kernel';
import type { AnyAgentEvent } from '@nib-ui/protocol';
import { sessionHostPlugin } from '../src/lib/server/plugins/session-host';
import type { AssetService, HarnessRegistry } from '../src/lib/server/services';

const capabilities = {
	interrupt: true,
	permissionModes: ['default'],
	resume: true,
	fork: false,
	slashCommands: false,
	models: true,
};

function event(seq: number, type: string, data: unknown): string {
	return JSON.stringify({ id: `e${seq}`, sessionId: 's1', seq, ts: 1_000 + seq, type, data } as AnyAgentEvent);
}

/** The host only asks the registry whether a harness can resume, so a stub is enough. */
const harnesses = {
	register: () => () => {},
	get: () => undefined,
	list: () => [],
} satisfies HarnessRegistry;

/** Restoring never touches an attachment; the host only needs the service to exist. */
const assets = {
	store: () => Promise.reject(new Error('not used')),
	read: () => Promise.resolve(null),
	path: () => Promise.resolve(null),
} satisfies AssetService;

async function restoreFrom(lines: string[]) {
	const logDirectory = await mkdtemp(join(tmpdir(), 'nib-titles-'));
	await writeFile(join(logDirectory, 's1.jsonl'), `${lines.join('\n')}\n`);

	const context = createContext();
	context.provide('harnesses', harnesses);
	context.provide('assets', assets);
	context.use(sessionHostPlugin, { logDirectory });
	return context.require('sessionHost').list();
}

function prompt(seq: number, text: string): string[] {
	return [
		event(seq, 'message.started', { messageId: `u${seq}`, role: 'user' }),
		event(seq + 1, 'block.started', { messageId: `u${seq}`, blockId: `u${seq}:0`, kind: 'text' }),
		event(seq + 2, 'block.completed', { blockId: `u${seq}:0`, content: { kind: 'text', text } }),
		event(seq + 3, 'message.completed', { messageId: `u${seq}` }),
	];
}

const created = event(1, 'session.created', { harnessId: 'claude-code', cwd: '/repos/one', capabilities });

describe('restoring a session without a title', () => {
	test('names it after the first prompt', async () => {
		const sessions = await restoreFrom([created, ...prompt(2, 'add a retry to the uploader'), ...prompt(6, 'now test it')]);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]!.title).toBe('add a retry to the uploader');
	});

	test('leaves a title the log already carries alone', async () => {
		const sessions = await restoreFrom([
			created,
			event(2, 'session.meta', { label: 'renamed by hand' }),
			...prompt(3, 'add a retry to the uploader'),
		]);
		expect(sessions[0]!.title).toBe('renamed by hand');
	});

	test('stays untitled when the log has no prompt to name it after', async () => {
		expect((await restoreFrom([created]))[0]!.title).toBeNull();
	});
});
