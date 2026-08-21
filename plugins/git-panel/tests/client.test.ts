import { describe, expect, test } from 'bun:test';
import { changeLabel, type GitFileChange } from '../src/client';

function change(overrides: Partial<GitFileChange>): GitFileChange {
	return { path: 'a.ts', indexStatus: ' ', worktreeStatus: ' ', staged: false, added: 0, removed: 0, ...overrides };
}

describe('changeLabel', () => {
	test('reads the index column for staged files and the worktree column otherwise', () => {
		expect(changeLabel(change({ staged: true, indexStatus: 'A', worktreeStatus: ' ' }))).toBe('added');
		expect(changeLabel(change({ staged: false, indexStatus: 'A', worktreeStatus: 'M' }))).toBe('modified');
	});

	test('names the remaining porcelain codes', () => {
		expect(changeLabel(change({ worktreeStatus: 'D' }))).toBe('deleted');
		expect(changeLabel(change({ worktreeStatus: 'R' }))).toBe('renamed');
		expect(changeLabel(change({ worktreeStatus: '?' }))).toBe('untracked');
		expect(changeLabel(change({ worktreeStatus: ' ' }))).toBe('changed');
	});
});
