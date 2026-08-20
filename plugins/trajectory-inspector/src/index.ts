import type { Plugin } from '@nib-ui/kernel';
import TrajectoryPanel from './TrajectoryPanel.svelte';
import { inspectorState } from './state.svelte';

export const trajectoryInspectorPlugin: Plugin = {
	name: 'trajectory-inspector',
	inject: ['slots', 'commands', 'sessions'],
	apply(ctx) {
		inspectorState.sessions = ctx.require('sessions');
		ctx.effect(() => ctx.require('slots').register('session.header', { component: TrajectoryPanel, order: 20 }));
		ctx.effect(() =>
			ctx.require('commands').register({
				id: 'trajectory.toggle',
				title: 'Toggle trajectory inspector',
				run: () => inspectorState.toggle(),
			}),
		);
		ctx.effect(() => () => {
			inspectorState.toggle(false);
			inspectorState.sessions = null;
		});
	},
};
