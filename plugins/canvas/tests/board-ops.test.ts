import { describe, expect, test } from 'bun:test';
import type { CanvasObject } from '@nib-ui/ui-contracts';
import { addObject, rebaseObjects, removeObjects, updateObject, withCascade } from '../src/board-ops';

function workstream(id: string, x = 0, y = 0): CanvasObject {
	return { kind: 'workstream', id, goal: '', x, y };
}

function edge(id: string, fromId: string, toId: string): CanvasObject {
	return { kind: 'edge', id, fromId, toId, label: 'branch', direction: 'forward' };
}

describe('addObject', () => {
	test('appends, and the board order is the draw order', () => {
		const objects = addObject([workstream('a')], workstream('b'));
		expect(objects.map((object) => object.id)).toEqual(['a', 'b']);
	});

	test('an id already on the board is not added twice', () => {
		const existing = [workstream('a')];
		expect(addObject(existing, workstream('a'))).toBe(existing);
	});
});

describe('updateObject', () => {
	test('patches only the object named', () => {
		const objects = updateObject([workstream('a'), workstream('b')], 'b', { x: 40 });

		expect(objects[0]).toEqual(workstream('a'));
		expect(objects[1]!.x).toBe(40);
	});

	test('a patch may move an object but never retype it', () => {
		const objects = updateObject([workstream('a')], 'a', { kind: 'note', id: 'z', x: 5 } as Partial<CanvasObject>);

		expect(objects[0]!.kind).toBe('workstream');
		expect(objects[0]!.id).toBe('a');
		expect(objects[0]!.x).toBe(5);
	});

	test('an unknown id leaves the board untouched', () => {
		const existing = [workstream('a')];
		expect(updateObject(existing, 'missing', { x: 9 })).toBe(existing);
	});

	test('a kind no plugin claims still takes a patch', () => {
		const exotic: CanvasObject = { kind: 'sticker', id: 's', x: 0, y: 0, mood: 'happy' };
		const objects = updateObject([exotic], 's', { x: 12 });

		expect(objects[0]).toEqual({ kind: 'sticker', id: 's', x: 12, y: 0, mood: 'happy' });
	});
});

describe('removeObjects', () => {
	test('an edge goes with either endpoint it hangs off', () => {
		const board = [workstream('a'), workstream('b'), edge('e', 'a', 'b')];

		expect(removeObjects(board, ['a']).map((object) => object.id)).toEqual(['b']);
		expect(removeObjects(board, ['b']).map((object) => object.id)).toEqual(['a']);
	});

	test('unrelated edges survive', () => {
		const board = [workstream('a'), workstream('b'), workstream('c'), edge('e', 'b', 'c')];
		expect(removeObjects(board, ['a']).map((object) => object.id)).toEqual(['b', 'c', 'e']);
	});

	test('the cascade reports what a delete will actually take', () => {
		const board = [workstream('a'), workstream('b'), edge('e', 'a', 'b')];
		expect(withCascade(board, ['a']).sort()).toEqual(['a', 'e']);
	});

	test('removing nothing is not a change', () => {
		const board = [workstream('a')];
		expect(removeObjects(board, [])).toBe(board);
	});
});

describe('rebaseObjects', () => {
	test("another window's objects survive this window's write", () => {
		const server = [workstream('a'), workstream('theirs')];
		const local = [workstream('a'), workstream('mine')];

		expect(rebaseObjects(server, local, []).map((object) => object.id)).toEqual(['a', 'theirs', 'mine']);
	});

	test('a local edit wins over the server copy of the same object', () => {
		const merged = rebaseObjects([workstream('a', 0, 0)], [workstream('a', 99, 99)], []);
		expect(merged[0]!.x).toBe(99);
	});

	test('what this window deleted stays deleted', () => {
		const merged = rebaseObjects([workstream('a'), workstream('b')], [workstream('b')], ['a']);
		expect(merged.map((object) => object.id)).toEqual(['b']);
	});

	test('a kind this build cannot render is carried through untouched', () => {
		const exotic: CanvasObject = { kind: 'stroke', id: 'ink', points: [{ x: 1, y: 2, pressure: 0.4 }], color: '#fff', width: 2 };
		const merged = rebaseObjects([exotic], [workstream('a')], []);

		expect(merged[0]).toEqual(exotic);
		expect(merged.map((object) => object.id)).toEqual(['ink', 'a']);
	});
});
