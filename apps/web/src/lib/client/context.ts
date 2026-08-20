import { createContext, type Context, type ForkHandle, type Plugin } from '@nib-ui/kernel';
import { coreRenderersPlugin } from '@nib-ui/plugin-core-renderers';
import { costTrackerPlugin } from '@nib-ui/plugin-cost-tracker';
import { rendererDiffPlugin } from '@nib-ui/plugin-renderer-diff';
import { rendererTerminalPlugin } from '@nib-ui/plugin-renderer-terminal';
import { trajectoryInspectorPlugin } from '@nib-ui/plugin-trajectory-inspector';
import { commandsPlugin, renderersPlugin, sessionsPlugin, slotsPlugin } from './plugins/core-services';
import { devCommandsPlugin } from './plugins/dev-commands';
import { transportPlugin } from './plugins/transport';

/** Statically loaded plugin manifest. Order is irrelevant — `inject` gates activation. */
const corePlugins: Plugin[] = [transportPlugin, sessionsPlugin, renderersPlugin, slotsPlugin, commandsPlugin];

const featurePlugins: Plugin[] = [
	coreRenderersPlugin,
	rendererDiffPlugin,
	rendererTerminalPlugin,
	costTrackerPlugin,
	trajectoryInspectorPlugin,
];

let context: Context | undefined;
const handles = new Map<string, ForkHandle>();

export function clientContext(): Context {
	if (context) return context;
	context = createContext();
	for (const plugin of [...corePlugins, ...featurePlugins]) handles.set(plugin.name, context.use(plugin));
	context.use(devCommandsPlugin, {
		pluginNames: featurePlugins.map((plugin) => plugin.name),
		toggle: togglePlugin,
	});
	return context;
}

export function pluginHandles(): Map<string, ForkHandle> {
	clientContext();
	return handles;
}

/** Dev affordance: unloading a plugin must remove everything it contributed. */
export function togglePlugin(name: string): boolean {
	const ctx = clientContext();
	const plugin = featurePlugins.find((entry) => entry.name === name);
	if (!plugin) throw new Error(`unknown plugin "${name}"`);

	const handle = handles.get(name);
	if (handle) {
		handle.dispose();
		handles.delete(name);
		return false;
	}
	handles.set(name, ctx.use(plugin));
	return true;
}
