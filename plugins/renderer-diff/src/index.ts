import type { Plugin } from '@nib-ui/kernel';
import DiffBlock from './DiffBlock.svelte';
import FileResultStrip from './FileResultStrip.svelte';

export const rendererDiffPlugin: Plugin = {
	name: 'renderer-diff',
	inject: ['renderers'],
	apply(ctx) {
		const renderers = ctx.require('renderers');
		for (const toolName of ['Edit', 'Write']) {
			ctx.effect(() => renderers.register({ kind: 'tool_use', toolName, priority: 10, component: DiffBlock }));
			ctx.effect(() =>
				renderers.register({ kind: 'tool_result', toolName, priority: 10, component: FileResultStrip }),
			);
		}
	},
};

export { diffLines, type DiffLine } from './diff';
