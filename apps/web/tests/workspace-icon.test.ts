import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { findWorkspaceIcon, rankIconFile } from '../src/lib/server/workspace-icon';

describe('rankIconFile', () => {
	test('ignores files that are not icon-shaped', () => {
		expect(rankIconFile('README.md')).toBeNull();
		expect(rankIconFile('favicon.txt')).toBeNull();
		expect(rankIconFile('iconography.png')).toBeNull();
	});

	test('prefers favicon over logo, and svg over png', () => {
		expect(rankIconFile('favicon.svg')!).toBeLessThan(rankIconFile('favicon.png')!);
		expect(rankIconFile('favicon.png')!).toBeLessThan(rankIconFile('logo.svg')!);
		expect(rankIconFile('favicon.svg')!).toBeLessThan(rankIconFile('favicon-32x32.svg')!);
	});

	test('accepts suffixed variants', () => {
		expect(rankIconFile('logo-dark.png')).not.toBeNull();
	});
});

describe('findWorkspaceIcon', () => {
	test('finds a favicon nested in a conventional directory', async () => {
		const root = await mkdtemp(join(tmpdir(), 'nib-icon-'));
		await mkdir(join(root, 'static'));
		await writeFile(join(root, 'README.md'), '# nope');
		await writeFile(join(root, 'static', 'favicon.png'), Buffer.from([1, 2, 3]));

		const icon = await findWorkspaceIcon(root);
		expect(icon?.path).toBe(join(root, 'static', 'favicon.png'));
		expect(icon?.contentType).toBe('image/png');
		expect(icon?.bytes.byteLength).toBe(3);
	});

	test('returns null when the workspace has no icon', async () => {
		const root = await mkdtemp(join(tmpdir(), 'nib-icon-'));
		await writeFile(join(root, 'index.ts'), 'export {};');
		expect(await findWorkspaceIcon(root)).toBeNull();
	});
});
