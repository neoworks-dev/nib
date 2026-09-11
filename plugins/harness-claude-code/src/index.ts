import type { Plugin } from "@nib-ui/kernel";
import { type ClaudeCodeHarnessConfig, createClaudeCodeAdapter } from "./adapter";

export type { ClaudeCodeHarnessConfig } from "./adapter";

export const claudeCodeHarness: Plugin<ClaudeCodeHarnessConfig> = {
  name: "harness-claude-code",
  inject: ["harnesses"],
  apply(ctx, config) {
    const harnesses = ctx.require("harnesses");
    ctx.effect(() => harnesses.register(createClaudeCodeAdapter(config)));
  },
};
