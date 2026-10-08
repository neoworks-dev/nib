import type { Plugin } from "@nib-ui/kernel";
import ChangedFilesPanel from "./ChangedFilesPanel.svelte";
import DiffBlock from "./DiffBlock.svelte";
import { diffState } from "./state.svelte";

/** Optional coupling: the link activates only while a file viewer is loaded. */
const viewerLinkPlugin: Plugin = {
  name: "renderer-diff:viewer-link",
  inject: ["fileViewer"],
  apply(ctx) {
    diffState.viewer = ctx.require("fileViewer");
    ctx.effect(() => () => {
      diffState.viewer = null;
    });
  },
};

export const rendererDiffPlugin: Plugin = {
  name: "renderer-diff",
  inject: ["renderers", "slots"],
  apply(ctx) {
    const renderers = ctx.require("renderers");
    ctx.effect(() =>
      ctx.require("slots").register("message.footer", { component: ChangedFilesPanel }),
    );
    // Every harness reports a file edit as an ACP `edit` call carrying a diff.
    ctx.effect(() =>
      renderers.register({ type: "tool", toolKind: "edit", priority: 10, component: DiffBlock }),
    );
    ctx.use(viewerLinkPlugin);
  },
};

export { type ChangedFile, type ChangeSummary, summarizeChanges } from "./changed-files";
export { type DiffLine, diffLines } from "./diff";
