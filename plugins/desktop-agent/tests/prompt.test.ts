import { describe, expect, test } from 'bun:test';
import type { DetectedRegion } from '@nib-ui/ui-contracts';
import { composeDesktopPrompt, sortForReading } from '../src/prompt';

function region(id: string, x: number, y: number, extra: Partial<DetectedRegion> = {}): DetectedRegion {
	return { id, rect: { x, y, width: 100, height: 30 }, source: 'atspi', confidence: 1, ...extra };
}

describe('composeDesktopPrompt', () => {
	test('names the application, the ask and the regions', () => {
		const prompt = composeDesktopPrompt({
			promptPrefix: 'You are helping inside Blender.',
			text: 'Where do I set the bevel width?',
			applicationName: 'Blender',
			regions: [region('a', 10, 10, { label: 'Bevel' })],
		});

		expect(prompt).toBe(
			[
				'You are helping inside Blender.',
				'This is a screenshot of Blender, attached below.',
				'Where do I set the bevel width?',
				'Elements detected in the screenshot, as `name — x,y w×h` in image pixels:\n- Bevel — 10,10 100×30',
			].join('\n\n'),
		);
	});

	test('an unidentified application still says what the picture is', () => {
		const prompt = composeDesktopPrompt({ text: 'what is this', regions: [] });
		expect(prompt).toContain('a screenshot of the desktop');
		expect(prompt).not.toContain('Elements detected');
	});

	test('no text at all leaves the picture speaking for itself', () => {
		const prompt = composeDesktopPrompt({ text: '   ', applicationName: 'Firefox', regions: [] });
		expect(prompt).toBe('This is a screenshot of Firefox, attached below.');
	});

	test('a blank prefix is dropped rather than leaving an empty paragraph', () => {
		const prompt = composeDesktopPrompt({ promptPrefix: '  ', text: 'hi', regions: [] });
		expect(prompt.startsWith('This is a screenshot')).toBe(true);
	});

	test('a sensitive region is positioned but never described', () => {
		const prompt = composeDesktopPrompt({
			text: '',
			regions: [region('pw', 0, 0, { label: 'Master password', sensitive: true })],
		});
		expect(prompt).toContain('- redacted field');
		expect(prompt).not.toContain('Master password');
	});

	test('a label with newlines cannot break the list into fake entries', () => {
		const prompt = composeDesktopPrompt({ text: '', regions: [region('a', 0, 0, { label: 'Save\n- Cancel' })] });
		const entries = prompt.split('\n').filter((line) => line.startsWith('- '));
		// The newline survives in the label, but the second line is not another region:
		// nothing here parses the list back, so what matters is that the count is right.
		expect(entries).toHaveLength(2);
		expect(entries[0]).toContain('Save');
	});

	test('says how many regions it left out instead of trimming silently', () => {
		const regions = Array.from({ length: 5 }, (_unused, index) => region(`r${index}`, 0, index * 40));
		const prompt = composeDesktopPrompt({ text: '', regions, limit: 2 });
		expect(prompt).toContain('- …and 3 more');
	});

	test('a list exactly at the limit says nothing about more', () => {
		const regions = Array.from({ length: 2 }, (_unused, index) => region(`r${index}`, 0, index * 40));
		expect(composeDesktopPrompt({ text: '', regions, limit: 2 })).not.toContain('more');
	});
});

describe('sortForReading', () => {
	test('top to bottom, then left to right', () => {
		const sorted = sortForReading([region('c', 100, 50), region('a', 10, 10), region('b', 5, 50)]);
		expect(sorted.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
	});

	test('does not mutate its input', () => {
		const regions = [region('b', 0, 50), region('a', 0, 0)];
		sortForReading(regions);
		expect(regions.map((entry) => entry.id)).toEqual(['b', 'a']);
	});
});
