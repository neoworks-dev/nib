import type { Plugin } from "@nib-ui/kernel";
import TreeStructureIcon from "phosphor-svelte/lib/TreeStructureIcon";
import FileBrowser from "./FileBrowser.svelte";
import { fileBrowserState } from "./state.svelte";

export const explorerPaneId = "files.explorer";

export const fileBrowserPlugin: Plugin = {
  name: "file-browser",
  inject: ["panes", "fileViewer"],
  apply(ctx) {
    fileBrowserState.viewer = ctx.require("fileViewer");
    ctx.effect(() =>
      ctx.require("panes").register({
        id: explorerPaneId,
        kind: "explorer",
        title: "Files",
        icon: TreeStructureIcon,
        component: FileBrowser,
      }),
    );
    ctx.effect(() => () => {
      fileBrowserState.viewer = null;
    });
  },
};

export { fetchTree, statusMark, statusTone, type TreeEntry, type TreeListing } from "./tree";
