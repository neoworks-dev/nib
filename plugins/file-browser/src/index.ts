import type { Plugin } from '@nib-ui/kernel';
import FileBrowser from './FileBrowser.svelte';
import { fileBrowserState } from './state.svelte';

export const fileBrowserPlugin: Plugin = {
	name: 'file-browser',
	inject: ['slots', 'fileViewer'],
	apply(ctx) {
		fileBrowserState.viewer = ctx.require('fileViewer');
		ctx.effect(() => ctx.require('slots').register('sidebar.nav', { component: FileBrowser, order: 10 }));
		ctx.effect(() => () => {
			fileBrowserState.viewer = null;
		});
	},
};

export { fetchTree, statusMark, statusTone, type TreeEntry, type TreeListing } from './tree';
