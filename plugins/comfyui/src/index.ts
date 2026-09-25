import type { Plugin } from "@nib-ui/kernel";
import type { ComfyEditorRequest } from "@nib-ui/ui-contracts";
import FlowArrowIcon from "phosphor-svelte/lib/FlowArrowIcon";
import GraphIcon from "phosphor-svelte/lib/GraphIcon";
import ComfySettings from "./ComfySettings.svelte";
import { manifestFromImport, readImport } from "./editor/document";
import EditorPane from "./editor/EditorPane.svelte";
import { errorMessage } from "./form";
import { comfyMenuItems } from "./menu";
import { mountPlaceholders } from "./placeholders.svelte";
import { ComfyStore, comfyPluginState } from "./store.svelte";
import WorkflowsPane from "./WorkflowsPane.svelte";

/** The pane listing the workflow library. */
export const WORKFLOWS_PANE = "comfyui.workflows";
/** The node graph editor. */
export const EDITOR_PANE = "comfyui.editor";

/**
 * ComfyUI in the app: provides the `comfy` service the library, the node editor
 * and the composer queue workflows through, the settings section that points
 * it at a server, the workflow library, and the node editor.
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
    ctx.effect(() => mountPlaceholders(canvas, store));

    ctx.effect(() => {
      comfyPluginState.store = store;
      comfyPluginState.host = { transport, panes, cwd: () => canvas.cwd };
      return () => {
        comfyPluginState.store = null;
        comfyPluginState.host = null;
        comfyPluginState.editorRequest = null;
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
    ctx.effect(() =>
      panes.register({
        id: EDITOR_PANE,
        kind: "comfyui-editor",
        title: "Node editor",
        icon: GraphIcon,
        component: EditorPane,
      }),
    );

    let serial = 0;
    /** Hands a request to the editor and brings it up. */
    const showInEditor = (request: ComfyEditorRequest): void => {
      serial += 1;
      comfyPluginState.editorRequest = { ...request, serial };
      panes.open(EDITOR_PANE);
    };
    ctx.effect(() => store.subscribeEditorRequests(showInEditor));

    /** Points the open workflows pane at a picture, or opens one for it. */
    const runWorkflowOn = (path: string): void => {
      const [existing] = panes.instances(WORKFLOWS_PANE);
      if (existing) panes.reparam(existing.instanceId, { image: path });
      panes.open(WORKFLOWS_PANE, { image: path });
    };
    /** Reads a vault file as a workflow and opens it in the editor. */
    const openFileInEditor = async (path: string): Promise<void> => {
      const cwd = canvas.cwd;
      try {
        const imported = readImport(await transport.readVaultFile(cwd, path));
        if (imported.kind === "none") throw new Error(`${path}: ${imported.reason}`);
        const name = path.slice(path.lastIndexOf("/") + 1);
        showInEditor({ source: "draft", manifest: manifestFromImport(imported, name), cwd });
      } catch (cause) {
        console.warn(`could not open ${path} in the node editor: ${errorMessage(cause)}`);
      }
    };
    ctx.effect(() =>
      canvas.registerContextMenu({
        // Ahead of the board's own entries, so the delete stays last.
        order: -10,
        items: (target) =>
          comfyMenuItems(target, {
            runWorkflowOn,
            openInEditor: (path) => void openFileInEditor(path),
            runIcon: FlowArrowIcon,
            editorIcon: GraphIcon,
          }),
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
    ctx.effect(() =>
      commands.register({
        id: "comfyui.editor",
        title: "ComfyUI: node editor",
        run: () => {
          panes.open(EDITOR_PANE);
        },
      }),
    );
  },
};

export { describeRun, isActive, upsertRun } from "./runs";
