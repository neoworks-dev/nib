import type { Plugin } from '@nib-ui/kernel';
import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
import BrowserPanel from './BrowserPanel.svelte';
import { webBrowserState } from './state.svelte';

const paneId = 'browser';

export const webBrowserPlugin: Plugin = {
	name: 'web-browser',
	inject: ['panes', 'commands'],
	apply(ctx) {
		const panes = ctx.require('panes');
		ctx.effect(() => panes.register({ id: paneId, title: 'Browser', icon: GlobeIcon, component: BrowserPanel }));
		ctx.effect(() =>
			ctx.require('commands').register({
				id: 'browser.toggle',
				title: 'Toggle web browser pane',
				run: () => panes.toggle(paneId),
			}),
		);
		ctx.effect(() => () => webBrowserState.reset());
	},
};

export { displayHost, normalizeUrl } from './url';
export { maxTabCount, webBrowserState, type BrowserTab } from './state.svelte';
