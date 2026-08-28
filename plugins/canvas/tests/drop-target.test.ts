import { describe, expect, test } from 'bun:test';
import type { CanvasObject } from '@nib-ui/ui-contracts';
import { CARD_MIN_HEIGHT, CARD_WIDTH, workstreamAt } from '../src/workstream';

function card(id: string, x: number, y: number, size: { w?: number; h?: number } = {}): CanvasObject {
	return { kind: 'workstream', id, sessionId: `session-${id}`, goal: '', x, y, ...size };
}

const cards = [card('w1', 0, 0), card('w2', 400, 0, { w: 300, h: 200 })];

describe('what a drop on the board is aimed at', () => {
	test('empty board space is aimed at nothing', () => {
		expect(workstreamAt(cards, { x: 1000, y: 1000 })).toBeNull();
	});

	test('inside a card is aimed at that card', () => {
		expect(workstreamAt(cards, { x: 500, y: 100 })).toMatchObject({ id: 'w2' });
	});

	test('a card with no size of its own is the default card box', () => {
		expect(workstreamAt(cards, { x: CARD_WIDTH - 1, y: CARD_MIN_HEIGHT - 1 })).toMatchObject({ id: 'w1' });
		expect(workstreamAt(cards, { x: CARD_WIDTH + 1, y: 10 })).toBeNull();
		expect(workstreamAt(cards, { x: 10, y: CARD_MIN_HEIGHT + 1 })).toBeNull();
	});

	test('the card drawn last wins where two overlap', () => {
		expect(workstreamAt([card('under', 0, 0), card('over', 0, 0)], { x: 10, y: 10 })).toMatchObject({ id: 'over' });
	});

	test('objects that are not cards are never the target', () => {
		const edges: CanvasObject[] = [
			{ kind: 'edge', id: 'e1', fromId: 'w1', toId: 'w2', label: 'link', direction: 'forward' },
		];

		expect(workstreamAt(edges, { x: 0, y: 0 })).toBeNull();
	});
});
