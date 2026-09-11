import type { Plugin } from "@nib-ui/kernel";
import { inspectorState } from "./state.svelte";
import TrajectoryPanel from "./TrajectoryPanel.svelte";

export const trajectoryInspectorPlugin: Plugin = {
  name: "trajectory-inspector",
  inject: ["slots", "commands", "sessions"],
  apply(ctx) {
    inspectorState.sessions = ctx.require("sessions");
    ctx.effect(() =>
      ctx.require("slots").register("session.header", { component: TrajectoryPanel, order: 20 }),
    );
    ctx.effect(() =>
      ctx.require("commands").register({
        id: "trajectory.toggle",
        title: "Toggle trajectory inspector",
        run: () => inspectorState.toggle(),
      }),
    );
    ctx.effect(() => () => {
      inspectorState.reset();
      inspectorState.sessions = null;
    });
  },
};
