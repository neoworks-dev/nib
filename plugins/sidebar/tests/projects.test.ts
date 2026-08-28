import { describe, expect, test } from 'bun:test';
import type { BoardSummary, BoardWorkstream, SessionSummary } from '@nib-ui/ui-contracts';
import { projectRows } from '../src/projects';

function workstream(partial: Partial<BoardWorkstream> & { id: string }): BoardWorkstream {
	return { goal: '', sessionId: null, reviewedAt: null, ...partial };
}

function board(cwd: string, workstreams: BoardWorkstream[], rev = 1): BoardSummary {
	return { cwd, rev, workstreams };
}

function summary(partial: Partial<SessionSummary> & { id: string; cwd: string }): SessionSummary {
	return { status: 'idle', title: null, updatedAt: 0, ...partial } as unknown as SessionSummary;
}

describe('projectRows', () => {
	test('keeps a workstream that has not been reviewed', () => {
		const rows = projectRows([board('/w/app', [workstream({ id: 'a', goal: 'Ship it' })])], []);
		expect(rows[0]?.workstreams.map((row) => row.title)).toEqual(['Ship it']);
	});

	test('drops a reviewed workstream that is doing nothing', () => {
		const rows = projectRows(
			[board('/w/app', [workstream({ id: 'a', reviewedAt: 5, sessionId: 's1' })])],
			[summary({ id: 's1', cwd: '/w/app', status: 'idle' })],
		);
		expect(rows[0]?.workstreams).toEqual([]);
	});

	test('keeps a reviewed workstream that started working again', () => {
		const rows = projectRows(
			[board('/w/app', [workstream({ id: 'a', reviewedAt: 5, sessionId: 's1' })])],
			[summary({ id: 's1', cwd: '/w/app', status: 'working' })],
		);
		expect(rows[0]?.workstreams.map((row) => row.active)).toEqual([true]);
	});

	test('counts waiting on the user as active', () => {
		const rows = projectRows(
			[board('/w/app', [workstream({ id: 'a', sessionId: 's1' })])],
			[summary({ id: 's1', cwd: '/w/app', status: 'awaiting-permission' })],
		);
		expect(rows[0]?.activeCount).toBe(1);
	});

	test('titles a launched workstream by its session, an unlaunched one by its goal', () => {
		const rows = projectRows(
			[
				board('/w/app', [
					workstream({ id: 'a', sessionId: 's1', goal: 'written down' }),
					workstream({ id: 'b', goal: 'first line\nsecond line' }),
					workstream({ id: 'c' }),
				]),
			],
			[summary({ id: 's1', cwd: '/w/app', title: 'Named by the harness' })],
		);
		expect(rows[0]?.workstreams.map((row) => row.title)).toEqual([
			'Named by the harness',
			'first line',
			'Workstream',
		]);
	});

	test('orders active work first, then by recency', () => {
		const rows = projectRows(
			[
				board('/w/app', [
					workstream({ id: 'idle-old', sessionId: 's1' }),
					workstream({ id: 'idle-new', sessionId: 's2' }),
					workstream({ id: 'busy', sessionId: 's3' }),
				]),
			],
			[
				summary({ id: 's1', cwd: '/w/app', updatedAt: 1 }),
				summary({ id: 's2', cwd: '/w/app', updatedAt: 2 }),
				summary({ id: 's3', cwd: '/w/app', status: 'working', updatedAt: 0 }),
			],
		);
		expect(rows[0]?.workstreams.map((row) => row.id)).toEqual(['busy', 'idle-new', 'idle-old']);
	});

	test('keeps a project whose workstreams are all reviewed, so the board stays reachable', () => {
		const rows = projectRows([board('/w/app', [workstream({ id: 'a', reviewedAt: 5 })])], []);
		expect(rows.map((row) => row.path)).toEqual(['/w/app']);
	});

	test('lists a recent directory that has no board yet', () => {
		const rows = projectRows([], [], ['/w/fresh']);
		expect(rows).toEqual([{ path: '/w/fresh', name: 'fresh', workstreams: [], activeCount: 0, updatedAt: 0 }]);
	});

	test('treats trailing slashes as the same project', () => {
		expect(projectRows([board('/w/app/', [])], [], ['/w/app'])).toHaveLength(1);
	});

	test('orders projects with active work ahead of the rest', () => {
		const rows = projectRows(
			[
				board('/w/quiet', [workstream({ id: 'q', sessionId: 's1' })]),
				board('/w/busy', [workstream({ id: 'b', sessionId: 's2' })]),
			],
			[
				summary({ id: 's1', cwd: '/w/quiet', updatedAt: 9 }),
				summary({ id: 's2', cwd: '/w/busy', status: 'working', updatedAt: 1 }),
			],
		);
		expect(rows.map((row) => row.path)).toEqual(['/w/busy', '/w/quiet']);
	});
});
