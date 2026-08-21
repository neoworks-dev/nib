import type { Plugin } from '@nib-ui/kernel';
import ChatPane from '../components/ChatPane.svelte';
import FallbackRenderer from '../components/FallbackRenderer.svelte';
import { ReactiveCommandRegistry } from '../registries/commands.svelte';
import { chatPaneId, ReactivePaneRegistry } from '../registries/panes.svelte';
import { ReactiveRendererRegistry } from '../registries/renderers.svelte';
import { ReactiveSessionsStore } from '../registries/sessions.svelte';
import { ReactiveSlotRegistry } from '../registries/slots.svelte';

export const sessionsPlugin: Plugin = {
	name: 'sessions',
	inject: ['transport'],
	apply(ctx) {
		const store = new ReactiveSessionsStore(ctx.require('transport'));
		ctx.provide('sessions', store);
		ctx.effect(() => () => store.disposeAll());
		void store.refresh();
	},
};

export const renderersPlugin: Plugin = {
	name: 'renderers',
	apply(ctx) {
		const registry = new ReactiveRendererRegistry();
		ctx.provide('renderers', registry);
		ctx.effect(() => registry.setFallback(FallbackRenderer));
	},
};

export const slotsPlugin: Plugin = {
	name: 'slots',
	apply(ctx) {
		ctx.provide('slots', new ReactiveSlotRegistry());
	},
};

export const panesPlugin: Plugin = {
	name: 'panes',
	apply(ctx) {
		const registry = new ReactivePaneRegistry();
		ctx.provide('panes', registry);
		// The chat is a pane like any other, so it tiles with whatever a plugin adds.
		ctx.effect(() => registry.register({ id: chatPaneId, title: 'Chat', component: ChatPane }));
		registry.open(chatPaneId);
	},
};

export const commandsPlugin: Plugin = {
	name: 'commands',
	apply(ctx) {
		const registry = new ReactiveCommandRegistry();
		ctx.provide('commands', registry);
		ctx.effect(() => {
			const onKeydown = (event: KeyboardEvent) => {
				if (!(event.ctrlKey || event.metaKey) || event.key !== 'k') return;
				event.preventDefault();
				registry.togglePalette();
			};
			window.addEventListener('keydown', onKeydown);
			return () => window.removeEventListener('keydown', onKeydown);
		});
	},
};
