import { type Context, createContext, type ForkHandle, type Plugin } from "@nib-ui/kernel";
import { canvasPlugin } from "@nib-ui/plugin-canvas";
import { canvas3dPlugin } from "@nib-ui/plugin-canvas-3d";
import { canvasLinksPlugin } from "@nib-ui/plugin-canvas-links";
import { canvasMediaPlugin } from "@nib-ui/plugin-canvas-media";
import { coreRenderersPlugin } from "@nib-ui/plugin-core-renderers";
import { costTrackerPlugin } from "@nib-ui/plugin-cost-tracker";
import { desktopAgentPlugin } from "@nib-ui/plugin-desktop-agent";
import { fileBrowserPlugin } from "@nib-ui/plugin-file-browser";
import { fileViewerPlugin } from "@nib-ui/plugin-file-viewer";
import { gauntletLoopPlugin } from "@nib-ui/plugin-gauntlet-loop";
import { gitGraphPlugin } from "@nib-ui/plugin-git-graph";
import { gitPanelPlugin } from "@nib-ui/plugin-git-panel";
import { rendererDiffPlugin } from "@nib-ui/plugin-renderer-diff";
import { rendererTerminalPlugin } from "@nib-ui/plugin-renderer-terminal";
import { settingsPlugin } from "@nib-ui/plugin-settings";
import { sidebarPlugin } from "@nib-ui/plugin-sidebar";
import { taskProgressPlugin } from "@nib-ui/plugin-task-progress";
import { trajectoryInspectorPlugin } from "@nib-ui/plugin-trajectory-inspector";
import { webBrowserPlugin } from "@nib-ui/plugin-web-browser";
import {
  commandsPlugin,
  panesPlugin,
  renderersPlugin,
  sessionsPlugin,
  slotsPlugin,
} from "./plugins/core-services";
import { devCommandsPlugin } from "./plugins/dev-commands";
import { paneLayoutPlugin } from "./plugins/pane-layout.svelte";
import { readRoutingPlugin } from "./plugins/read-routing.svelte";
import { transportPlugin } from "./plugins/transport";
import { workspaceDropsPlugin } from "./plugins/workspace-drops";

/** Statically loaded plugin manifest. Order is irrelevant — `inject` gates activation. */
const corePlugins: Plugin[] = [
  transportPlugin,
  sessionsPlugin,
  renderersPlugin,
  slotsPlugin,
  commandsPlugin,
  panesPlugin,
  paneLayoutPlugin,
];

const featurePlugins: Plugin[] = [
  canvasPlugin,
  canvasMediaPlugin,
  canvasLinksPlugin,
  canvas3dPlugin,
  coreRenderersPlugin,
  sidebarPlugin,
  taskProgressPlugin,
  rendererDiffPlugin,
  rendererTerminalPlugin,
  costTrackerPlugin,
  desktopAgentPlugin,
  trajectoryInspectorPlugin,
  gitPanelPlugin,
  gitGraphPlugin,
  fileViewerPlugin,
  fileBrowserPlugin,
  gauntletLoopPlugin,
  webBrowserPlugin,
  settingsPlugin,
  readRoutingPlugin,
  workspaceDropsPlugin,
];

let context: Context | undefined;
const handles = new Map<string, ForkHandle>();

export function clientContext(): Context {
  if (context) return context;
  context = createContext();
  for (const plugin of [...corePlugins, ...featurePlugins])
    handles.set(plugin.name, context.use(plugin));
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
