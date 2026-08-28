import { describe, expect, test } from 'bun:test';
import { branchSeed, digestOf, joinLabel, joinSeed, transcriptDigest } from '../src/digest';

describe('digestOf', () => {
	test('clips a long answer so the seed stays a prompt, not a transcript', () => {
		const digest = digestOf('short', 'x'.repeat(900));

		expect(digest!.reply).toHaveLength(701);
		expect(digest!.reply.endsWith('…')).toBe(true);
	});

	test('an empty workstream carries nothing forward', () => {
		expect(digestOf('', '')).toBeNull();
		expect(digestOf('   ', '\n')).toBeNull();
	});

	test('a goal with no answer yet still travels', () => {
		expect(digestOf('rewrite the parser', '')).toEqual({ prompt: 'rewrite the parser', reply: '' });
	});
});

describe('branchSeed', () => {
	test('without context the question is sent as written', () => {
		expect(branchSeed([], '  why is it slow?  ')).toBe('why is it slow?');
	});

	test('the seed names the thread as context and fences off the side question', () => {
		const seed = branchSeed([{ prompt: 'add caching', reply: 'done' }], 'is the cache warm on boot?');

		expect(seed).toContain('1. Asked: add caching');
		expect(seed).toContain('Answered: done');
		expect(seed).toContain('Answer only the side question below.');
		expect(seed.endsWith('is the cache warm on boot?')).toBe(true);
	});
});

describe('joinSeed', () => {
	test('every source is numbered in the order it was picked', () => {
		const seed = joinSeed(
			[
				{ prompt: 'first', reply: 'a' },
				{ prompt: 'second', reply: 'b' },
			],
			'compare them',
		);

		expect(seed.indexOf('1. Asked: first')).toBeLessThan(seed.indexOf('2. Asked: second'));
		expect(seed.endsWith('compare them')).toBe(true);
	});

	test('with nothing to fold in it is just the instruction', () => {
		expect(joinSeed([], 'go')).toBe('go');
	});
});

describe('joinLabel', () => {
	test('names the join after the first source and counts the rest', () => {
		expect(joinLabel([{ prompt: 'parser work', reply: '' }, { prompt: 'lexer work', reply: '' }])).toBe(
			'parser work +1',
		);
	});

	test('a join of nothing is still labelled', () => {
		expect(joinLabel([])).toBe('Join');
	});
});

describe('transcriptDigest', () => {
	const turns = [
		{ prompt: 'first', reply: 'a' },
		{ prompt: 'second', reply: 'b' },
		{ prompt: 'third', reply: 'c' },
	];

	test('carries every turn in transcript order when it fits', () => {
		expect(transcriptDigest(turns)).toEqual(turns);
	});

	test('drops the oldest turns when the budget runs out', () => {
		expect(transcriptDigest(turns, 14)).toEqual([
			{ prompt: 'second', reply: 'b' },
			{ prompt: 'third', reply: 'c' },
		]);
	});

	test('the newest turn travels even when it alone is over budget', () => {
		expect(transcriptDigest(turns, 1)).toEqual([{ prompt: 'third', reply: 'c' }]);
	});

	test('a turn with neither a prompt nor an answer is skipped, not counted', () => {
		const withBlank = [{ prompt: '', reply: '  ' }, ...turns];

		expect(transcriptDigest(withBlank)).toEqual(turns);
	});

	test('a workstream that never ran carries nothing', () => {
		expect(transcriptDigest([])).toEqual([]);
	});
});
