import type { Plugin } from '@nib-ui/kernel';
import SwordIcon from 'phosphor-svelte/lib/SwordIcon';
import GauntletPanel from './GauntletPanel.svelte';
import { gauntletState } from './state.svelte';

export const gauntletLoopPlugin: Plugin = {
	name: 'gauntlet-loop',
	inject: ['panes', 'commands', 'sessions', 'renderers'],
	apply(ctx) {
		const panes = ctx.require('panes');
		gauntletState.sessions = ctx.require('sessions');
		gauntletState.renderers = ctx.require('renderers');
		ctx.effect(() => panes.register({ id: 'gauntlet', kind: 'gauntlet', title: 'Gauntlet', icon: SwordIcon, component: GauntletPanel }));
		ctx.effect(() =>
			ctx.require('commands').register({
				id: 'gauntlet.toggle',
				title: 'Toggle supervised gauntlet pane',
				run: () => panes.toggle('gauntlet'),
			}),
		);
		ctx.effect(() => () => gauntletState.reset());
	},
};

export {
	composeHandoff,
	lastAssistantMessage,
	messageText,
	nextHandoff,
	peerRole,
	relayAllowed,
	relayModes,
	type PaneRole,
	type RelayMode,
} from './relay';
