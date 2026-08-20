import { describe, expect, test } from 'bun:test';
import { applyTrigger, detectTrigger } from '../src/lib/client/composer-trigger';

describe('detectTrigger', () => {
	test('a leading slash opens the command trigger', () => {
		expect(detectTrigger('/rev', 4)).toEqual({ kind: 'slash', query: 'rev', start: 0, end: 4 });
	});

	test('a slash inside a path is not a command trigger', () => {
		expect(detectTrigger('look at src/lib', 15)).toBeNull();
	});

	test('an at sign after whitespace opens the file trigger', () => {
		expect(detectTrigger('read @src/app', 13)).toEqual({ kind: 'file', query: 'src/app', start: 5, end: 13 });
	});

	test('an at sign glued to a word is not a trigger', () => {
		expect(detectTrigger('mail me@example.com', 19)).toBeNull();
	});

	test('whitespace after the trigger closes it', () => {
		expect(detectTrigger('/review the diff', 16)).toBeNull();
	});

	test('only the text before the caret counts', () => {
		expect(detectTrigger('/rev and more', 4)).toEqual({ kind: 'slash', query: 'rev', start: 0, end: 4 });
	});

	test('no trigger characters at all', () => {
		expect(detectTrigger('plain text', 10)).toBeNull();
	});
});

describe('applyTrigger', () => {
	test('replaces the trigger span and leaves the caret after a trailing space', () => {
		const trigger = detectTrigger('/rev', 4)!;
		expect(applyTrigger('/rev', trigger, 'review')).toEqual({ text: '/review ', caret: 8 });
	});

	test('keeps the text that follows the caret', () => {
		const text = 'read @src/ap and stop';
		const trigger = detectTrigger(text, 12)!;
		expect(applyTrigger(text, trigger, 'src/app.css')).toEqual({
			text: 'read @src/app.css  and stop',
			caret: 18,
		});
	});
});
