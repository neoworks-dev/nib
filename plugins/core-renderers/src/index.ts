import type { Plugin } from "@nib-ui/kernel";
import { agentToolNames, askUserQuestionToolName, mcpToolName } from "@nib-ui/protocol";
import AskQuestionCard from "./AskQuestionCard.svelte";
import ReadBlock from "./ReadBlock.svelte";
import SpawnAgentBlock from "./SpawnAgentBlock.svelte";
import TextBlock from "./TextBlock.svelte";
import ThinkingBlock from "./ThinkingBlock.svelte";
import ToolUseBlock from "./ToolUseBlock.svelte";

/** Both spellings `isAgentTool` accepts: the bare name pi logs, the MCP one the others do. */
const spawnTools = [agentToolNames.spawn, mcpToolName(agentToolNames.spawn)];

export const coreRenderersPlugin: Plugin = {
  name: "core-renderers",
  inject: ["renderers"],
  apply(ctx) {
    const renderers = ctx.require("renderers");
    ctx.effect(() => renderers.register({ type: "text", component: TextBlock }));
    ctx.effect(() => renderers.register({ type: "thought", component: ThinkingBlock }));
    ctx.effect(() => renderers.register({ type: "tool", component: ToolUseBlock }));
    // Every harness files a file read under ACP's `read` kind, whatever its tool is called.
    ctx.effect(() =>
      renderers.register({ type: "tool", toolKind: "read", priority: 10, component: ReadBlock }),
    );
    // Starting an agent is not a tool call to read: the card stands for the agent
    // itself, and opens it. The other agent-control tools keep the generic card.
    for (const toolName of spawnTools) {
      ctx.effect(() =>
        renderers.register({
          type: "tool",
          toolName,
          priority: 10,
          component: SpawnAgentBlock,
        }),
      );
    }
    ctx.effect(() =>
      renderers.registerPermission({
        toolName: askUserQuestionToolName,
        component: AskQuestionCard,
      }),
    );
  },
};
