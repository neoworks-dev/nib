import type { Plugin } from '@nib-ui/kernel';
import FileCodeIcon from 'phosphor-svelte/lib/FileCodeIcon';
import type { FileViewerService, PaneRegistry } from '@nib-ui/ui-contracts';
import FileViewer from './FileViewer.svelte';
import { fileViewerState } from './state.svelte';

const paneId = 'files.viewer';

function service(panes: PaneRegistry): FileViewerService {
	return {
		// Opening a file shows the pane: the request is what makes it relevant.
		open: async (sessionId, path) => {
			panes.open(paneId);
			await fileViewerState.open(sessionId, path);
		},
		close: (path) => fileViewerState.close(path),
	};
}

export const fileViewerPlugin: Plugin = {
	name: 'file-viewer',
	inject: ['panes'],
	apply(ctx) {
		const panes = ctx.require('panes');
		ctx.provide('fileViewer', service(panes));
		ctx.effect(() => panes.register({ id: paneId, title: 'Editor', icon: FileCodeIcon, component: FileViewer }));
		ctx.effect(() => () => fileViewerState.reset());
	},
};

export { highlightLines, languageFor } from './highlight';
export { fileViewerState, type OpenFile } from './state.svelte';
