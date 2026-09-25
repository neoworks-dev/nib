import type { Plugin } from "@nib-ui/kernel";
import TreeStructureIcon from "phosphor-svelte/lib/TreeStructureIcon";
import FileBrowser from "./FileBrowser.svelte";
import { fileBrowserState } from "./state.svelte";

export const explorerPaneId = "files.explorer";

export const fileBrowserPlugin: Plugin = {
  name: "file-browser",
  inject: ["panes", "commands", "fileViewer"],
  apply(ctx) {
    const panes = ctx.require("panes");
    fileBrowserState.viewer = ctx.require("fileViewer");
    ctx.effect(() =>
      panes.register({
        id: explorerPaneId,
        kind: "explorer",
        title: "Files",
        icon: TreeStructureIcon,
        component: FileBrowser,
      }),
    );
    // The explorer opens beside a file the viewer was asked for; this is the way
    // to it when there is no file to click.
    ctx.effect(() =>
      ctx.require("commands").register({
        id: "files.toggle",
        title: "Toggle the file explorer",
        run: () => panes.toggle(explorerPaneId),
      }),
    );
    ctx.effect(() => () => {
      fileBrowserState.viewer = null;
    });
  },
};

export { fetchTree, statusMark, statusTone, type TreeEntry, type TreeListing } from "./tree";
