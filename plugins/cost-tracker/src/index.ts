import type { Plugin } from "@nib-ui/kernel";
import CostStatus from "./CostStatus.svelte";

/**
 * What a conversation has cost, in that conversation's own title row. It is not
 * app-wide state: two chats open side by side have two different bills.
 */
export const costTrackerPlugin: Plugin = {
  name: "cost-tracker",
  inject: ["slots"],
  apply(ctx) {
    const slots = ctx.require("slots");
    ctx.effect(() =>
      slots.register("chat.actions", {
        component: CostStatus,
        order: 10,
        when: (session) => session !== null,
      }),
    );
  },
};
