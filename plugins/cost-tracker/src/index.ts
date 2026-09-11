import type { Plugin } from "@nib-ui/kernel";
import CostStatus from "./CostStatus.svelte";

export const costTrackerPlugin: Plugin = {
  name: "cost-tracker",
  inject: ["slots"],
  apply(ctx) {
    const slots = ctx.require("slots");
    ctx.effect(() => slots.register("statusbar", { component: CostStatus, order: 10 }));
  },
};
