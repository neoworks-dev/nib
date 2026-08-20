import { describe, expect, test } from 'bun:test';
import type { SessionSummary } from '@nib-ui/ui-contracts';
import { groupSessionsByWorkspace, workspaceName } from '../src/lib/client/session-groups';
import { formatRelativeTime } from '../src/lib/client/relative-time';

function summary(id: string, cwd: string, updatedAt: number): SessionSummary {
	return {
		id,
		harnessId: 'claude-code',
		cwd,
		title: id,
		status: 'idle',
		model: 'sonnet',
		createdAt: updatedAt,
		updatedAt,
		lastSeq: 1,
	};
}

describe('workspaceName', () => {
	test('uses the last path segment', () => {
		expect(workspaceName('/home/dev/projects/nib-ui')).toBe('nib-ui');
		expect(workspaceName('/home/dev/projects/nib-ui/')).toBe('nib-ui');
		expect(workspaceName('/')).toBe('/');
	});
});

describe('groupSessionsByWorkspace', () => {
	test('groups by directory, newest first at both levels', () => {
		const groups = groupSessionsByWorkspace([
			summary('a', '/repos/one', 100),
			summary('b', '/repos/two', 300),
			summary('c', '/repos/one', 200),
		]);

		expect(groups.map((group) => group.name)).toEqual(['two', 'one']);
		expect(groups[1]?.sessions.map((session) => session.id)).toEqual(['c', 'a']);
	});

	test('is empty without sessions', () => {
		expect(groupSessionsByWorkspace([])).toEqual([]);
	});
});

describe('formatRelativeTime', () => {
	const now = 10_000_000_000;

	test('scales from seconds to weeks', () => {
		expect(formatRelativeTime(now - 5_000, now)).toBe('now');
		expect(formatRelativeTime(now - 4 * 60_000, now)).toBe('4m');
		expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe('2h');
		expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe('3d');
		expect(formatRelativeTime(now - 21 * 86_400_000, now)).toBe('3w');
	});

	test('clamps a clock that runs behind the event', () => {
		expect(formatRelativeTime(now + 5_000, now)).toBe('now');
	});
});
