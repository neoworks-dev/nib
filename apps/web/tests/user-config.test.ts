import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeUserConfig, readUserConfig, updateUserConfig, userConfigPath } from '../src/lib/server/user-config';

describe('mergeUserConfig', () => {
	it('keeps settings written by other builds', () => {
		const merged = mergeUserConfig({ theme: 'dark', defaultModels: { codex: 'gpt-5' } }, {
			defaultModels: { 'claude-code': 'sonnet' },
		});
		expect(merged).toEqual({ theme: 'dark', defaultModels: { codex: 'gpt-5', 'claude-code': 'sonnet' }, lastProject: null });
	});

	it('drops non-string model entries', () => {
		expect(mergeUserConfig({ defaultModels: { codex: 7 } }, {}).defaultModels).toEqual({});
	});

	it('keeps the stored project when the patch does not name one', () => {
		expect(mergeUserConfig({ lastProject: '/w/app' }, { defaultModels: {} }).lastProject).toBe('/w/app');
	});

	it('takes the project from the patch', () => {
		expect(mergeUserConfig({ lastProject: '/w/app' }, { lastProject: '/w/other' }).lastProject).toBe('/w/other');
	});
});

describe('user config file', () => {
	let previous: string | undefined;
	let directory: string;

	beforeEach(() => {
		previous = process.env.XDG_CONFIG_HOME;
		directory = mkdtempSync(join(tmpdir(), 'nib-config-'));
		process.env.XDG_CONFIG_HOME = directory;
	});

	afterEach(() => {
		if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previous;
		rmSync(directory, { recursive: true, force: true });
	});

	it('reads an empty config when the file is missing', async () => {
		expect(await readUserConfig()).toEqual({ defaultModels: {}, lastProject: null });
	});

	it('creates the file on first write and reads the value back', async () => {
		await updateUserConfig({ defaultModels: { 'claude-code': 'opus' } });

		expect(userConfigPath()).toBe(join(directory, 'nib', 'config.json'));
		expect(JSON.parse(readFileSync(userConfigPath(), 'utf8')).defaultModels).toEqual({ 'claude-code': 'opus' });
		expect(await readUserConfig()).toEqual({ defaultModels: { 'claude-code': 'opus' }, lastProject: null });
	});

	it('falls back to an empty config when the file is corrupt', async () => {
		mkdirSync(join(directory, 'nib'), { recursive: true });
		writeFileSync(userConfigPath(), '{ not json');

		expect(await readUserConfig()).toEqual({ defaultModels: {}, lastProject: null });
	});
});
