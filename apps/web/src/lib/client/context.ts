import { createContext, type Context, type ForkHandle, type Plugin } from '@nib-ui/kernel';
import { coreRenderersPlugin } from '@nib-ui/plugin-core-renderers';
import { commandsPlugin, renderersPlugin, sessionsPlugin, slotsPlugin } from './plugins/core-services';
import { transportPlugin } from './plugins/transport';

/** Statically loaded plugin manifest. Order is irrelevant — `inject` gates activation. */
const manifest: Plugin[] = [
	transportPlugin,
	sessionsPlugin,
	renderersPlugin,
	slotsPlugin,
	commandsPlugin,
	coreRenderersPlugin,
];

let context: Context | undefined;
const handles = new Map<string, ForkHandle>();

export function clientContext(): Context {
	if (context) return context;
	context = createContext();
	for (const plugin of manifest) handles.set(plugin.name, context.use(plugin));
	return context;
}

export function pluginHandles(): Map<string, ForkHandle> {
	clientContext();
	return handles;
}

/** Dev affordance: prove that unloading a plugin removes everything it contributed. */
export function togglePlugin(name: string): boolean {
	const ctx = clientContext();
	const handle = handles.get(name);
	const plugin = manifest.find((entry) => entry.name === name);
	if (!plugin) throw new Error(`unknown plugin "${name}"`);

	if (handle) {
		handle.dispose();
		handles.delete(name);
		return false;
	}
	handles.set(name, ctx.use(plugin));
	return true;
}
