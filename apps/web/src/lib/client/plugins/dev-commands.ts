import type { Plugin } from '@nib-ui/kernel';

export interface DevCommandsConfig {
	pluginNames: string[];
	toggle(name: string): boolean;
}

/** Proves plugins unload cleanly: every togglable plugin gets a palette entry. */
export const devCommandsPlugin: Plugin<DevCommandsConfig> = {
	name: 'dev-commands',
	inject: ['commands', 'sessions'],
	apply(ctx, config) {
		const commands = ctx.require('commands');
		const sessions = ctx.require('sessions');

		for (const name of config.pluginNames) {
			ctx.effect(() =>
				commands.register({
					id: `plugin.toggle.${name}`,
					title: `Toggle plugin: ${name}`,
					run: () => void config.toggle(name),
				}),
			);
		}

		ctx.effect(() =>
			commands.register({
				id: 'session.refresh',
				title: 'Refresh session list',
				run: () => sessions.refresh(),
			}),
		);
		ctx.effect(() =>
			commands.register({
				id: 'session.interrupt',
				title: 'Interrupt the current turn',
				run: () => sessions.interrupt(),
			}),
		);
	},
};
