import type { Plugin } from '@nib-ui/kernel';
import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
import GitPanel from './GitPanel.svelte';
import { gitPanelState } from './state.svelte';

export const gitPanelPlugin: Plugin = {
	name: 'git-panel',
	inject: ['panes', 'commands'],
	apply(ctx) {
		const panes = ctx.require('panes');
		ctx.effect(() => panes.register({ id: 'git', title: 'Git', icon: GitBranchIcon, component: GitPanel }));
		ctx.effect(() =>
			ctx.require('commands').register({
				id: 'git.toggle',
				title: 'Toggle git pane',
				run: () => panes.toggle('git'),
			}),
		);
		ctx.effect(() => () => gitPanelState.reset());
	},
};

export { changeLabel, fetchStatus, type GitFileChange, type GitStatus } from './client';
