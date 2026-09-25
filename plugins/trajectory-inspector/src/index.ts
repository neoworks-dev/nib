import type { Plugin } from "@nib-ui/kernel";
import PulseIcon from "phosphor-svelte/lib/PulseIcon";
import { toggleTrajectory, trajectoryPaneId } from "./open";
import TrajectoryButton from "./TrajectoryButton.svelte";
import TrajectoryPane from "./TrajectoryPane.svelte";

/**
 * The trajectory inspector: a property pane of a chat. It docks beside the
 * conversation it inspects, opened from a button in that chat's title row, and
 * reads the chat's session rather than the one in the foreground.
 */
export const trajectoryInspectorPlugin: Plugin = {
  name: "trajectory-inspector",
  inject: ["slots", "commands", "panes", "attachments", "sessions"],
  apply(ctx) {
    const panes = ctx.require("panes");
    const attachments = ctx.require("attachments");

    ctx.effect(() =>
      panes.register({
        id: trajectoryPaneId,
        kind: "inspector",
        title: "Trajectory",
        icon: PulseIcon,
        component: TrajectoryPane,
      }),
    );
    ctx.effect(() =>
      ctx.require("slots").register("chat.actions", {
        component: TrajectoryButton,
        order: 20,
        when: (session) => session !== null,
      }),
    );
    ctx.effect(() =>
      ctx.require("commands").register({
        id: "trajectory.toggle",
        title: "Toggle trajectory inspector",
        run: () => toggleTrajectory(panes, attachments),
      }),
    );
  },
};
