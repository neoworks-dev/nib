import type { Plugin } from "@nib-ui/kernel";
import type { CanvasObject } from "@nib-ui/ui-contracts";
import FlowArrowIcon from "phosphor-svelte/lib/FlowArrowIcon";
import ComfySettings from "./ComfySettings.svelte";
import { ComfyStore, comfyPluginState } from "./store.svelte";
import WorkflowsPane from "./WorkflowsPane.svelte";

/** The pane listing the workflow library. */
export const WORKFLOWS_PANE = "comfyui.workflows";

/** A picture card's vault path; null for anything else on the board. */
function picturePath(target: CanvasObject | null): string | null {
  if (!target || target.kind !== "visual" || target.video === true) return null;
  if (typeof target.path !== "string") return null;
  return target.path;
}

/**
 * ComfyUI in the app: provides the `comfy` service the library, the node editor
 * and the composer queue workflows through, the settings section that points
 * it at a server, and the workflow library pane.
 */
export const comfyuiPlugin: Plugin = {
  name: "comfyui",
  inject: ["transport", "slots", "commands", "panes", "canvas"],
  apply(ctx) {
    const transport = ctx.require("transport");
    const panes = ctx.require("panes");
    const canvas = ctx.require("canvas");
    const store = new ComfyStore(transport);
    ctx.effect(() => store.connect());
    ctx.provide("comfy", store);

    ctx.effect(() => {
      comfyPluginState.store = store;
      comfyPluginState.host = { transport, panes, cwd: () => canvas.cwd };
      return () => {
        comfyPluginState.store = null;
        comfyPluginState.host = null;
      };
    });
    ctx.effect(() =>
      ctx.require("slots").register("settings.section", { component: ComfySettings, order: 30 }),
    );
    ctx.effect(() =>
      panes.register({
        id: WORKFLOWS_PANE,
        kind: "comfyui-workflows",
        title: "Workflows",
        icon: FlowArrowIcon,
        component: WorkflowsPane,
      }),
    );
    /** Points the open workflows pane at a picture, or opens one for it. */
    const openWorkflowsFor = (path: string): void => {
      const [existing] = panes.instances(WORKFLOWS_PANE);
      if (existing) panes.reparam(existing.instanceId, { image: path });
      panes.open(WORKFLOWS_PANE, { image: path });
    };
    ctx.effect(() =>
      canvas.registerContextMenu({
        // Ahead of the board's own entries, so the delete stays last.
        order: -10,
        items: (target) => {
          const path = picturePath(target);
          if (path === null) return [];
          return [
            {
              kind: "action",
              id: "comfyui.runWorkflow",
              label: "Run workflow…",
              icon: FlowArrowIcon,
              run: () => openWorkflowsFor(path),
            },
            { kind: "separator", id: "comfyui.separator" },
          ];
        },
      }),
    );
    const commands = ctx.require("commands");
    ctx.effect(() =>
      commands.register({
        id: "comfyui.settings",
        title: "ComfyUI: connection and runs",
        run: () => {
          panes.open("settings");
        },
      }),
    );
    ctx.effect(() =>
      commands.register({
        id: "comfyui.workflows",
        title: "ComfyUI: workflows",
        run: () => {
          panes.open(WORKFLOWS_PANE);
        },
      }),
    );
  },
};

export { describeRun, isActive, upsertRun } from "./runs";
