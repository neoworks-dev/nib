import type { Plugin } from "@nib-ui/kernel";
import TerminalBlock from "./TerminalBlock.svelte";

export const rendererTerminalPlugin: Plugin = {
  name: "renderer-terminal",
  inject: ["renderers"],
  apply(ctx) {
    const renderers = ctx.require("renderers");
    ctx.effect(() =>
      renderers.register({
        kind: "tool_use",
        toolName: "Bash",
        priority: 10,
        component: TerminalBlock,
      }),
    );
    ctx.effect(() =>
      renderers.register({
        kind: "tool_result",
        toolName: "Bash",
        priority: 10,
        component: TerminalBlock,
      }),
    );
  },
};

export { stripAnsi } from "./ansi";
