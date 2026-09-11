import type { Plugin } from "@nib-ui/kernel";
import { type CodexHarnessConfig, createCodexAdapter } from "./adapter";

export type { CodexHarnessConfig } from "./adapter";

export const codexHarness: Plugin<CodexHarnessConfig> = {
  name: "harness-codex",
  inject: ["harnesses"],
  apply(ctx, config) {
    const harnesses = ctx.require("harnesses");
    ctx.effect(() => harnesses.register(createCodexAdapter(config)));
  },
};
