import type { Plugin } from "@nib-ui/kernel";
import Sidebar from "./Sidebar.svelte";
import { sidebarState } from "./state.svelte";

/**
 * The left rail: the projects on disk and, under each, the workstreams that
 * still want attention. It is contributed into `app.sidebar` rather than built
 * into the shell, so the shell reserves the space and draws nothing in it.
 */
export const sidebarPlugin: Plugin = {
  name: "sidebar",
  inject: ["slots", "sessions", "transport", "canvas"],
  apply(ctx) {
    sidebarState.attach({
      transport: ctx.require("transport"),
      sessions: ctx.require("sessions"),
      canvas: ctx.require("canvas"),
    });

    ctx.effect(() => ctx.require("slots").register("app.sidebar", { component: Sidebar }));
    ctx.effect(() => sidebarState.startPolling());
    ctx.effect(() => () => sidebarState.detach());

    void sidebarState.refresh().then(() => sidebarState.restoreLastProject());
  },
};

export { type ProjectRow, projectRows, type WorkstreamRow } from "./projects";
export { workspaceIconUrl, workspaceInitials } from "./workspace-badge";
