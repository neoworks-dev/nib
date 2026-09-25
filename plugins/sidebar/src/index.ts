import type { Plugin } from "@nib-ui/kernel";
import ProjectSwitcher from "./ProjectSwitcher.svelte";
import { sidebarState } from "./state.svelte";

/**
 * The project switcher: the projects on disk and, under each, the workstreams
 * that still want attention, behind one button in the top-left toolbar. It is
 * contributed into `app.toolbar` rather than built into the shell, so the shell
 * draws the bar and nothing in it.
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

    ctx.effect(() => ctx.require("slots").register("app.toolbar", { component: ProjectSwitcher }));
    ctx.effect(() => sidebarState.startPolling());
    ctx.effect(() => () => sidebarState.detach());

    void sidebarState.refresh().then(() => sidebarState.restoreLastProject());
  },
};

export { type ProjectRow, projectRows, type WorkstreamRow } from "./projects";
export { workspaceIconUrl, workspaceInitials } from "./workspace-badge";
