import { describe, expect, test } from 'bun:test';
import {
	edgeFromPoint,
	insertPane,
	leaf,
	movePane,
	paneIds,
	removePane,
	setRatio,
	type TileNode,
} from '../src/lib/client/layout/tiles';

function rect(width: number, height: number) {
	return { left: 0, top: 0, width, height };
}

describe('insertPane', () => {
	test('the first pane becomes the whole layout', () => {
		expect(insertPane(null, null, 'right', 'chat')).toEqual(leaf('chat'));
	});

	test('splits the target on the requested edge', () => {
		const layout = insertPane(leaf('chat'), 'chat', 'right', 'git') as Extract<TileNode, { kind: 'split' }>;

		expect(layout.kind).toBe('split');
		expect(layout.direction).toBe('row');
		expect(paneIds(layout)).toEqual(['chat', 'git']);

		const above = insertPane(leaf('chat'), 'chat', 'top', 'git') as Extract<TileNode, { kind: 'split' }>;
		expect(above.direction).toBe('column');
		expect(paneIds(above)).toEqual(['git', 'chat']);
	});

	test('re-inserting an open pane moves it instead of duplicating it', () => {
		const layout = insertPane(insertPane(leaf('chat'), 'chat', 'right', 'git'), 'chat', 'bottom', 'git');
		expect(paneIds(layout)).toEqual(['chat', 'git']);
	});
});

describe('removePane', () => {
	test('collapses the split that held it', () => {
		const layout = insertPane(leaf('chat'), 'chat', 'right', 'git');
		expect(removePane(layout, 'git')).toEqual(leaf('chat'));
	});

	test('an empty layout is null', () => {
		expect(removePane(leaf('chat'), 'chat')).toBeNull();
		expect(removePane(null, 'chat')).toBeNull();
	});
});

describe('movePane', () => {
	test('re-tiles a pane against another one', () => {
		const three = insertPane(insertPane(leaf('chat'), 'chat', 'right', 'git'), 'git', 'right', 'editor');
		const moved = movePane(three, 'editor', 'chat', 'bottom') as Extract<TileNode, { kind: 'split' }>;

		expect(paneIds(moved).sort()).toEqual(['chat', 'editor', 'git']);
		expect(JSON.stringify(moved)).toContain('"direction":"column"');
	});

	test('moving a pane onto itself changes nothing', () => {
		const layout = insertPane(leaf('chat'), 'chat', 'right', 'git');
		expect(movePane(layout, 'git', 'git', 'left')).toBe(layout);
	});
});

describe('setRatio', () => {
	test('clamps to keep both sides usable', () => {
		const layout = insertPane(leaf('chat'), 'chat', 'right', 'git');
		expect((setRatio(layout, [], 0.01) as Extract<TileNode, { kind: 'split' }>).ratio).toBeCloseTo(0.15);
		expect((setRatio(layout, [], 0.6) as Extract<TileNode, { kind: 'split' }>).ratio).toBeCloseTo(0.6);
	});
});

describe('edgeFromPoint', () => {
	test('picks the nearest edge of the drop target', () => {
		expect(edgeFromPoint(rect(100, 100), 5, 50)).toBe('left');
		expect(edgeFromPoint(rect(100, 100), 95, 50)).toBe('right');
		expect(edgeFromPoint(rect(100, 100), 50, 5)).toBe('top');
		expect(edgeFromPoint(rect(100, 100), 50, 95)).toBe('bottom');
	});
});
