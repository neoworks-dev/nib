import { describe, expect, test } from 'bun:test';
import { assignLanes, laneCount, type GraphCommit } from '../src/graph';

function commit(hash: string, ...parents: string[]): GraphCommit {
	return { hash, parents };
}

describe('assignLanes', () => {
	test('a linear history stays in one lane', () => {
		const rows = assignLanes([commit('a', 'b'), commit('b', 'c'), commit('c')]);

		expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
		expect(rows.map((row) => row.colourIndex)).toEqual([0, 0, 0]);
		expect(rows[0]!.edges).toEqual([{ fromLane: 0, toLane: 0, kind: 'branch', colourIndex: 0 }]);
		expect(rows[1]!.edges).toEqual([{ fromLane: 0, toLane: 0, kind: 'straight', colourIndex: 0 }]);
		expect(rows[2]!.edges).toEqual([{ fromLane: 0, toLane: 0, kind: 'merge', colourIndex: 0 }]);
		expect(laneCount(rows)).toBe(1);
	});

	test('the oldest visible commit keeps its lane open for the parent below the window', () => {
		const rows = assignLanes([commit('a', 'b'), commit('b', 'offscreen')]);

		expect(rows[1]!.edges).toEqual([{ fromLane: 0, toLane: 0, kind: 'straight', colourIndex: 0 }]);
	});

	test('a merge commit opens a second lane that converges on the shared parent', () => {
		const rows = assignLanes([
			commit('merge', 'main', 'feature'),
			commit('main', 'base'),
			commit('feature', 'base'),
			commit('base'),
		]);

		expect(rows.map((row) => row.lane)).toEqual([0, 0, 1, 0]);
		expect(rows.map((row) => row.colourIndex)).toEqual([0, 0, 1, 0]);
		expect(laneCount(rows)).toBe(2);

		expect(rows[0]!.edges).toEqual([
			{ fromLane: 0, toLane: 0, kind: 'branch', colourIndex: 0 },
			{ fromLane: 0, toLane: 1, kind: 'branch', colourIndex: 1 },
		]);
		expect(rows[1]!.edges).toEqual([
			{ fromLane: 1, toLane: 1, kind: 'straight', colourIndex: 1 },
			{ fromLane: 0, toLane: 0, kind: 'straight', colourIndex: 0 },
		]);
		expect(rows[2]!.edges).toEqual([
			{ fromLane: 0, toLane: 0, kind: 'straight', colourIndex: 0 },
			{ fromLane: 1, toLane: 1, kind: 'straight', colourIndex: 1 },
		]);
		expect(rows[3]!.edges).toEqual([
			{ fromLane: 1, toLane: 0, kind: 'merge', colourIndex: 1 },
			{ fromLane: 0, toLane: 0, kind: 'merge', colourIndex: 0 },
		]);
	});

	test('a merge whose second parent is already on a lane joins that lane', () => {
		const rows = assignLanes([
			commit('tip', 'merge'),
			commit('side', 'base'),
			commit('merge', 'main', 'base'),
			commit('main', 'base'),
			commit('base'),
		]);

		expect(rows.map((row) => row.lane)).toEqual([0, 1, 0, 0, 0]);
		expect(rows[2]!.edges).toContainEqual({ fromLane: 0, toLane: 1, kind: 'branch', colourIndex: 1 });
		expect(rows[4]!.edges).toContainEqual({ fromLane: 1, toLane: 0, kind: 'merge', colourIndex: 1 });
	});

	test('two independent roots reuse the freed lane with a fresh colour', () => {
		const rows = assignLanes([commit('a', 'b'), commit('b'), commit('c', 'd'), commit('d')]);

		expect(rows.map((row) => row.lane)).toEqual([0, 0, 0, 0]);
		expect(rows.map((row) => row.colourIndex)).toEqual([0, 0, 1, 1]);
		expect(rows[2]!.edges).toEqual([{ fromLane: 0, toLane: 0, kind: 'branch', colourIndex: 1 }]);
		expect(rows[3]!.edges).toEqual([{ fromLane: 0, toLane: 0, kind: 'merge', colourIndex: 1 }]);
		expect(laneCount(rows)).toBe(1);
	});

	test('an empty log produces no rows', () => {
		expect(assignLanes([])).toEqual([]);
	});
});
