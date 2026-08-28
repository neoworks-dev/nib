import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boardsDirectory, dataHome, migrateLegacySessionLogs, sessionsDirectory } from '../src/lib/server/data-dir';

describe('dataHome', () => {
	let previous: string | undefined;

	beforeEach(() => {
		previous = process.env.XDG_DATA_HOME;
	});

	afterEach(() => {
		if (previous === undefined) delete process.env.XDG_DATA_HOME;
		else process.env.XDG_DATA_HOME = previous;
	});

	it('follows XDG_DATA_HOME when it is set', () => {
		process.env.XDG_DATA_HOME = '/data';

		expect(dataHome()).toBe('/data/nib-ui');
		expect(sessionsDirectory()).toBe('/data/nib-ui/sessions');
		expect(boardsDirectory()).toBe('/data/nib-ui/boards');
	});

	it('falls back to ~/.local/share, not to the working directory', () => {
		process.env.XDG_DATA_HOME = '   ';

		expect(dataHome()).toMatch(/\.local\/share\/nib-ui$/);
	});
});

describe('migrateLegacySessionLogs', () => {
	let root: string;
	let legacy: string;
	let target: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'nib-migrate-'));
		legacy = join(root, '.nib-ui', 'sessions');
		target = join(root, 'xdg', 'sessions');
		mkdirSync(legacy, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('moves the logs an earlier build wrote into the XDG directory', () => {
		writeFileSync(join(legacy, 'a.jsonl'), 'a\n', 'utf8');
		writeFileSync(join(legacy, 'b.jsonl'), 'b\n', 'utf8');

		expect(migrateLegacySessionLogs(legacy, target).sort()).toEqual(['a.jsonl', 'b.jsonl']);
		expect(readdirSync(target).sort()).toEqual(['a.jsonl', 'b.jsonl']);
		expect(existsSync(legacy)).toBe(false);
	});

	it('is a no-op the second time, so a restart does not re-run it', () => {
		writeFileSync(join(legacy, 'a.jsonl'), 'a\n', 'utf8');
		migrateLegacySessionLogs(legacy, target);

		expect(migrateLegacySessionLogs(legacy, target)).toEqual([]);
		expect(readdirSync(target)).toEqual(['a.jsonl']);
	});

	it('the new location wins: a name already there is never overwritten', () => {
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, 'a.jsonl'), 'newer\n', 'utf8');
		writeFileSync(join(legacy, 'a.jsonl'), 'older\n', 'utf8');

		expect(migrateLegacySessionLogs(legacy, target)).toEqual([]);
		expect(readFileSync(join(target, 'a.jsonl'), 'utf8')).toBe('newer\n');
		// The unclaimed log stays where it is rather than being deleted.
		expect(existsSync(join(legacy, 'a.jsonl'))).toBe(true);
	});

	it('ignores files that are not session logs', () => {
		writeFileSync(join(legacy, 'notes.txt'), 'x', 'utf8');

		expect(migrateLegacySessionLogs(legacy, target)).toEqual([]);
		expect(existsSync(target)).toBe(false);
	});

	it('a project that never had a legacy directory needs no migration', () => {
		expect(migrateLegacySessionLogs(join(root, 'absent'), target)).toEqual([]);
	});
});
