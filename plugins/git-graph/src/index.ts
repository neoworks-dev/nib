import type { Plugin } from '@nib-ui/kernel';
import GitGraphOverlay from './GitGraphOverlay.svelte';
import { gitGraphState } from './state.svelte';

export const gitGraphPlugin: Plugin = {
	name: 'git-graph',
	inject: ['slots', 'commands'],
	apply(ctx) {
		ctx.effect(() =>
			ctx
				.require('slots')
				.register('session.header', { component: GitGraphOverlay, order: 11, when: (session) => session !== null }),
		);
		ctx.effect(() =>
			ctx.require('commands').register({
				id: 'git.graph.toggle',
				title: 'Toggle git graph',
				run: () => gitGraphState.toggle(),
			}),
		);
		ctx.effect(() => () => gitGraphState.reset());
	},
};

export { fetchLog, type GitLog, type GitLogEntry } from './client';
export {
	assignLanes,
	laneCount,
	type GraphCommit,
	type GraphEdge,
	type GraphEdgeKind,
	type GraphRow,
} from './graph';
