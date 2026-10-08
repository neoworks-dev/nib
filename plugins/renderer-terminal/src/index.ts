import type { Plugin } from "@nib-ui/kernel";
import TerminalBlock from "./TerminalBlock.svelte";

export const rendererTerminalPlugin: Plugin = {
  name: "renderer-terminal",
  inject: ["renderers"],
  apply(ctx) {
    const renderers = ctx.require("renderers");
    // Every harness files a shell command under ACP's `execute` kind, whatever
    // its tool is called (Claude's `Bash`, pi's `bash`, Codex's own).
    ctx.effect(() =>
      renderers.register({
        type: "tool",
        toolKind: "execute",
        priority: 10,
        component: TerminalBlock,
      }),
    );
  },
};

export { stripAnsi } from "./ansi";
