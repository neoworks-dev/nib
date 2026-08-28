import type { Plugin } from '@nib-ui/kernel';
import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon';
import GeneralSettings from './GeneralSettings.svelte';
import type { SettingsService } from './settings';
import SettingsPane from './SettingsPane.svelte';
import { settingsState } from './state.svelte';

declare module '@nib-ui/kernel' {
	interface Services {
		settings: SettingsService;
	}
}

export const settingsPlugin: Plugin = {
	name: 'settings',
	inject: ['panes', 'commands', 'slots', 'sessions'],
	apply(ctx) {
		const panes = ctx.require('panes');
		const slots = ctx.require('slots');

		settingsState.load();
		settingsState.slots = slots;
		settingsState.sessions = ctx.require('sessions');
		ctx.provide('settings', settingsState);

		ctx.effect(() => settingsState.watchTheme());
		ctx.effect(() => panes.register({ id: 'settings', kind: 'settings', title: 'Settings', icon: GearSixIcon, component: SettingsPane }));
		// The built-in sections go through the public slot, so nothing here is special-cased.
		ctx.effect(() => slots.register('settings.section', { component: GeneralSettings, order: 0 }));
		ctx.effect(() =>
			ctx.require('commands').register({
				id: 'settings.toggle',
				title: 'Toggle settings pane',
				run: () => panes.toggle('settings'),
			}),
		);
		ctx.effect(() => () => settingsState.detach());
	},
};

export {
	defaultSettings,
	loadSettings,
	parseSettings,
	resolveTheme,
	saveSettings,
	settingsStorageKey,
	themePreferences,
	type SettingsService,
	type ThemePreference,
	type UserSettings,
} from './settings';
