import { describe, expect, test } from 'bun:test';
import { planExplorer } from '../src/explorer';

describe('the explorer an editor opens with', () => {
	test('a fresh editor gets one', () => {
		expect(planExplorer({ attached: false, paired: false })).toBe('attach');
	});

	test('an editor that already has one is left alone', () => {
		expect(planExplorer({ attached: true, paired: true })).toBe('keep');
	});

	test('an explorer that arrived some other way counts as the one it has', () => {
		expect(planExplorer({ attached: true, paired: false })).toBe('keep');
	});

	test('an editor whose explorer was closed or dragged off does not get another', () => {
		expect(planExplorer({ attached: false, paired: true })).toBe('dismissed');
	});
});
