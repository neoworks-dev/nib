import { describe, expect, test } from 'bun:test';
import { canvasObjectKindForPath } from '../src/lib/client/workspace-files';

describe('what a workspace file becomes on the board', () => {
	test('pictures, video and pdf are the media object', () => {
		expect(canvasObjectKindForPath('shots/hero.png')).toBe('media');
		expect(canvasObjectKindForPath('a/b/clip.MP4')).toBe('media');
		expect(canvasObjectKindForPath('docs/spec.pdf')).toBe('media');
		expect(canvasObjectKindForPath('loop.gif')).toBe('media');
	});

	test('model files are the 3d object', () => {
		expect(canvasObjectKindForPath('art/ship.glb')).toBe('model');
		expect(canvasObjectKindForPath('art/ship.STL')).toBe('model');
		expect(canvasObjectKindForPath('art/ship.obj')).toBe('model');
		expect(canvasObjectKindForPath('art/ship.gltf')).toBe('model');
	});

	test('a type no renderer claims gets no object kind invented for it', () => {
		expect(canvasObjectKindForPath('src/index.ts')).toBeNull();
		expect(canvasObjectKindForPath('README')).toBeNull();
		expect(canvasObjectKindForPath('data/rows.csv')).toBeNull();
		expect(canvasObjectKindForPath('notes.md')).toBeNull();
	});
});
