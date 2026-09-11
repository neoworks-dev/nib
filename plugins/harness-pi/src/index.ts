import type { Plugin } from "@nib-ui/kernel";
import { createPiAdapter, type PiHarnessConfig } from "./adapter";

export type { PiHarnessConfig } from "./adapter";

export const piHarness: Plugin<PiHarnessConfig> = {
  name: "harness-pi",
  inject: ["harnesses"],
  apply(ctx, config) {
    const harnesses = ctx.require("harnesses");
    ctx.effect(() => harnesses.register(createPiAdapter(config)));
  },
};
