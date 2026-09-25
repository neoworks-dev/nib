import type { Plugin } from "@nib-ui/kernel";
import FolderOpenIcon from "phosphor-svelte/lib/FolderOpenIcon";
import ExplorerButton from "./ExplorerButton.svelte";
import { projectExplorerPaneId } from "./pane";
import ProjectExplorer from "./ProjectExplorer.svelte";
import { projectExplorerState } from "./state.svelte";

/**
 * The project as it is on disk, beside the board that stands for it. Its kind is
 * its own rather than `explorer`: the editor attaches an explorer to itself by
 * kind, and what it wants there is the tree of the session it is reading.
 */
export const projectExplorerPlugin: Plugin = {
  name: "project-explorer",
  inject: ["panes", "commands", "slots", "canvas", "fileViewer"],
  apply(ctx) {
    const panes = ctx.require("panes");
    projectExplorerState.canvas = ctx.require("canvas");
    projectExplorerState.viewer = ctx.require("fileViewer");

    ctx.effect(() =>
      panes.register({
        id: projectExplorerPaneId,
        kind: "project-explorer",
        title: "Project",
        icon: FolderOpenIcon,
        component: ProjectExplorer,
      }),
    );
    ctx.effect(() =>
      ctx.require("slots").register("app.toolbar", { component: ExplorerButton, order: 15 }),
    );
    ctx.effect(() =>
      ctx.require("commands").register({
        id: "project-explorer.toggle",
        title: "Toggle the project explorer",
        run: () => panes.toggle(projectExplorerPaneId),
      }),
    );
    ctx.effect(() => () => projectExplorerState.reset());
  },
};

export { projectExplorerPaneId } from "./pane";
export { fetchTree, statusMark, statusTone, type TreeEntry, type TreeListing } from "./tree";
