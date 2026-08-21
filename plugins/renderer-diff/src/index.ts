import type { Plugin } from '@nib-ui/kernel';
import ChangedFilesPanel from './ChangedFilesPanel.svelte';
import DiffBlock from './DiffBlock.svelte';
import FileResultStrip from './FileResultStrip.svelte';
import { diffState } from './state.svelte';

/** Optional coupling: the link activates only while a file viewer is loaded. */
const viewerLinkPlugin: Plugin = {
	name: 'renderer-diff:viewer-link',
	inject: ['fileViewer'],
	apply(ctx) {
		diffState.viewer = ctx.require('fileViewer');
		ctx.effect(() => () => {
			diffState.viewer = null;
		});
	},
};

export const rendererDiffPlugin: Plugin = {
	name: 'renderer-diff',
	inject: ['renderers', 'slots'],
	apply(ctx) {
		const renderers = ctx.require('renderers');
		ctx.effect(() => ctx.require('slots').register('message.footer', { component: ChangedFilesPanel }));
		for (const toolName of ['Edit', 'Write']) {
			ctx.effect(() => renderers.register({ kind: 'tool_use', toolName, priority: 10, component: DiffBlock }));
			ctx.effect(() =>
				renderers.register({ kind: 'tool_result', toolName, priority: 10, component: FileResultStrip }),
			);
		}
		ctx.use(viewerLinkPlugin);
	},
};

export { summarizeChanges, type ChangedFile, type ChangeSummary } from './changed-files';
export { diffLines, type DiffLine } from './diff';
