import type { Plugin } from "@nib-ui/kernel";
import type { AttachmentsService, FileViewerService, PaneRegistry } from "@nib-ui/ui-contracts";
import FileCodeIcon from "phosphor-svelte/lib/FileCodeIcon";
import { planExplorer } from "./explorer";
import FileViewer from "./FileViewer.svelte";
import { fileViewerState } from "./state.svelte";

const paneId = "files.viewer";

/**
 * Editor instances an explorer has already been opened for. Missing from this
 * set the editor has never had one; in it without one beside it, the user got
 * rid of it.
 */
const paired = new Set<string>();

/**
 * The tree beside the file. It is asked for by kind, not by id: whichever plugin
 * provides the explorer is not the editor's business.
 */
function openExplorer(
  panes: PaneRegistry,
  attachments: AttachmentsService,
  editorInstanceId: string,
): void {
  const plan = planExplorer({
    attached: attachments.find(editorInstanceId, "explorer") !== undefined,
    paired: paired.has(editorInstanceId),
  });
  if (plan !== "attach") return;

  const explorer = panes.list().find((definition) => definition.kind === "explorer");
  if (!explorer) return;
  paired.add(editorInstanceId);
  attachments.attach(panes.openInstance(explorer.id), editorInstanceId, "left");
  // `attach` focuses what it moved; the file was asked for, so the editor keeps it.
  panes.open(paneId);
}

function service(panes: PaneRegistry, attachments: AttachmentsService): FileViewerService {
  return {
    // Opening a file shows the pane: the request is what makes it relevant. A
    // background open is the agent's doing rather than the user's, so it neither
    // raises the pane nor takes the tab in front of them.
    open: async (sessionId, path, options) => {
      const activate = options?.activate !== false;
      if (activate) openExplorer(panes, attachments, panes.open(paneId));
      await fileViewerState.open(sessionId, path, activate);
    },
    close: (path) => fileViewerState.close(path),
  };
}

export const fileViewerPlugin: Plugin = {
  name: "file-viewer",
  inject: ["panes", "attachments", "sessions"],
  apply(ctx) {
    const panes = ctx.require("panes");
    fileViewerState.sessions = ctx.require("sessions");
    ctx.provide("fileViewer", service(panes, ctx.require("attachments")));
    ctx.effect(() =>
      panes.register({
        id: paneId,
        kind: "editor",
        title: "Editor",
        icon: FileCodeIcon,
        component: FileViewer,
      }),
    );
    ctx.effect(() => () => {
      paired.clear();
      fileViewerState.reset();
    });
  },
};

export { describeRange, type Selection, selectionPrompt, sliceLines } from "./ask";
export {
  type FileEdit,
  type Hunk,
  hunkRange,
  latestEdits,
  placeHunks,
  type ReviewLine,
  type ReviewOutcome,
  reviewLines,
  reviewMessage,
  type Verdict,
} from "./changes";
export { type ExplorerPlan, type ExplorerState, planExplorer } from "./explorer";
export { highlightLines, languageFor } from "./highlight";
export { fileViewerState, type OpenFile } from "./state.svelte";
