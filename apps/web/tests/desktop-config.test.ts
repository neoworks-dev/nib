import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { desktopConfigPath, readDesktopConfig, writeDesktopConfig } from '../src/lib/server/desktop-config';

describe('the desktop-agent config file', () => {
	let previous: string | undefined;
	let directory: string;

	beforeEach(() => {
		previous = process.env.XDG_CONFIG_HOME;
		directory = mkdtempSync(join(tmpdir(), 'nib-desktop-config-'));
		process.env.XDG_CONFIG_HOME = directory;
	});

	afterEach(() => {
		if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = previous;
		rmSync(directory, { recursive: true, force: true });
	});

	function write(contents: string): void {
		mkdirSync(dirname(desktopConfigPath()), { recursive: true });
		writeFileSync(desktopConfigPath(), contents, 'utf8');
	}

	it('sits beside the config the rest of the app writes', () => {
		expect(desktopConfigPath()).toBe(join(directory, 'nib', 'desktop-agent.json'));
	});

	it('answers an empty document when there is no file', async () => {
		expect(await readDesktopConfig()).toEqual({});
	});

	it('answers an empty document for a corrupt file rather than throwing', async () => {
		write('{ this is not json');
		expect(await readDesktopConfig()).toEqual({});
	});

	it.each([
		['an array', '[1, 2, 3]'],
		['a string', '"nope"'],
		['null', 'null'],
	])('answers an empty document for %s, which no rule can be read out of', async (_name, contents) => {
		write(contents);
		expect(await readDesktopConfig()).toEqual({});
	});

	it('writes what it was given and reads it back', async () => {
		await writeDesktopConfig({ version: 1, applications: [{ match: { appId: 'blender' }, policy: 'allow' }] });
		expect(await readDesktopConfig()).toEqual({
			version: 1,
			applications: [{ match: { appId: 'blender' }, policy: 'allow' }],
		});
	});

	it('keeps a key a newer build wrote', async () => {
		write(JSON.stringify({ version: 2, futureField: 'kept', applications: [] }));
		const merged = await writeDesktopConfig({ applications: [{ match: { appId: 'a' }, policy: 'deny' }] });
		expect(merged.futureField).toBe('kept');
		expect(merged.version).toBe(2);
	});

	it('replaces the rule list wholesale rather than concatenating it', async () => {
		await writeDesktopConfig({ applications: [{ match: { appId: 'a' }, policy: 'deny' }] });
		const merged = await writeDesktopConfig({ applications: [{ match: { appId: 'b' }, policy: 'allow' }] });
		expect(merged.applications).toEqual([{ match: { appId: 'b' }, policy: 'allow' }]);
	});

	it('creates the directory rather than failing on a first write', async () => {
		await writeDesktopConfig({ version: 1 });
		expect(JSON.parse(readFileSync(desktopConfigPath(), 'utf8'))).toEqual({ version: 1 });
	});
});
