import { describe, expect, test } from 'bun:test';
import { domainOf, parseBookmark, soleUrl } from '../src/bookmark';

describe('soleUrl', () => {
	test('claims a paste that is exactly one link', () => {
		expect(soleUrl('https://example.com/a')).toBe('https://example.com/a');
		expect(soleUrl('  http://example.com  ')).toBe('http://example.com/');
	});

	test('leaves prose that merely mentions a link alone', () => {
		expect(soleUrl('see https://example.com for more')).toBeNull();
		expect(soleUrl('https://a.test https://b.test')).toBeNull();
	});

	test('refuses a scheme the preview route would reject anyway', () => {
		expect(soleUrl('file:///etc/passwd')).toBeNull();
		expect(soleUrl('javascript:alert(1)')).toBeNull();
		expect(soleUrl('data:text/html,<b>x</b>')).toBeNull();
	});

	test('nothing pasted is not a link', () => {
		expect(soleUrl(undefined)).toBeNull();
		expect(soleUrl('   ')).toBeNull();
		expect(soleUrl('not a url')).toBeNull();
	});
});

describe('domainOf', () => {
	test('drops the www a card does not need to show', () => {
		expect(domainOf('https://www.example.com/a/b')).toBe('example.com');
		expect(domainOf('https://docs.example.com/')).toBe('docs.example.com');
	});

	test('an unparseable url stands in for its own domain', () => {
		expect(domainOf('not a url')).toBe('not a url');
	});
});

describe('parseBookmark', () => {
	const stored = { kind: 'bookmark', id: 'b1', x: 1, y: 2, url: 'https://www.example.com/a' };

	test('fills in a title and domain an older build did not write', () => {
		expect(parseBookmark(stored)).toEqual({
			kind: 'bookmark',
			id: 'b1',
			x: 1,
			y: 2,
			url: 'https://www.example.com/a',
			title: 'https://www.example.com/a',
			domain: 'example.com',
		});
	});

	test('keeps the scraped fields when they are there', () => {
		expect(
			parseBookmark({ ...stored, title: 'T', domain: 'example.com', description: 'D', imageAssetId: 'a.png' }),
		).toMatchObject({ title: 'T', description: 'D', imageAssetId: 'a.png' });
	});

	test('a bookmark with no url is not a bookmark', () => {
		expect(parseBookmark({ ...stored, url: '' })).toBeNull();
		expect(parseBookmark({ ...stored, y: null })).toBeNull();
		expect(parseBookmark({ ...stored, kind: 'media' })).toBeNull();
	});
});
