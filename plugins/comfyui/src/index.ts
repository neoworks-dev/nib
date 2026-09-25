import type { Plugin } from "@nib-ui/kernel";
import ComfySettings from "./ComfySettings.svelte";
import { ComfyStore, comfyPluginState } from "./store.svelte";

/**
 * ComfyUI in the app: provides the `comfy` service the library, the node editor
 * and the composer queue workflows through, and the settings section that points
 * it at a server.
 */
export const comfyuiPlugin: Plugin = {
  name: "comfyui",
  inject: ["transport", "slots", "commands", "panes"],
  apply(ctx) {
    const store = new ComfyStore(ctx.require("transport"));
    ctx.effect(() => store.connect());
    ctx.provide("comfy", store);

    ctx.effect(() => {
      comfyPluginState.store = store;
      return () => {
        comfyPluginState.store = null;
      };
    });
    ctx.effect(() =>
      ctx.require("slots").register("settings.section", { component: ComfySettings, order: 30 }),
    );
    ctx.effect(() =>
      ctx.require("commands").register({
        id: "comfyui.settings",
        title: "ComfyUI: connection and runs",
        run: () => {
          ctx.require("panes").open("settings");
        },
      }),
    );
  },
};

export { describeRun, isActive, upsertRun } from "./runs";
