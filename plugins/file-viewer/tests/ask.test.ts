import { describe, expect, test } from 'bun:test';
import { describeRange, selectionPrompt, sliceLines } from '../src/ask';

const selection = { from: 12, to: 14, text: 'const a = 1;\nconst b = 2;\nconst c = 3;' };

describe('sliceLines', () => {
	const text = ['alpha', 'beta', 'gamma', 'delta'].join('\n');

	test('takes an inclusive 1-based range', () => {
		expect(sliceLines(text, 2, 3)).toBe('beta\ngamma');
	});

	test('takes a single line', () => {
		expect(sliceLines(text, 1, 1)).toBe('alpha');
	});

	test('stops at the end of the file', () => {
		expect(sliceLines(text, 3, 99)).toBe('gamma\ndelta');
	});
});

describe('describeRange', () => {
	test('names a span and a single line differently', () => {
		expect(describeRange(selection)).toBe('lines 12–14');
		expect(describeRange({ ...selection, from: 12, to: 12 })).toBe('line 12');
	});
});

describe('selectionPrompt', () => {
	test('quotes the selected lines under the file and range', () => {
		expect(selectionPrompt('/repo/a.ts', selection, 'why is this not a loop?')).toBe(
			[
				'In /repo/a.ts, lines 12–14:',
				'',
				'```',
				'const a = 1;',
				'const b = 2;',
				'const c = 3;',
				'```',
				'',
				'why is this not a loop?',
			].join('\n'),
		);
	});

	test('is null when the user typed nothing', () => {
		expect(selectionPrompt('/repo/a.ts', selection, '   ')).toBeNull();
	});

	test('caps a selection that is really a paste', () => {
		const text = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n');
		const prompt = selectionPrompt('/repo/a.ts', { from: 1, to: 100, text }, 'explain')!;
		expect(prompt).toContain('line 39');
		expect(prompt).not.toContain('line 40');
		expect(prompt).toContain('…');
	});
});
