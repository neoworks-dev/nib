<script lang="ts">
  import { blockToolInput, blockToolOutput, findToolResultBlock } from "@nib-ui/protocol";
  import type { RendererProps } from "@nib-ui/ui-contracts";
  import CircleNotchIcon from "phosphor-svelte/lib/CircleNotchIcon";
  import WrenchIcon from "phosphor-svelte/lib/WrenchIcon";
  import BlockShell from "./BlockShell.svelte";

  const { block, session }: RendererProps = $props();

  const input = $derived(blockToolInput(block));
  const serialized = $derived(typeof input === "string" ? input : JSON.stringify(input, null, 2));

  // The result renders folded into its call, so an expanded call has to carry it.
  const result = $derived(findToolResultBlock(session, block.toolUseId));
  const output = $derived(blockToolOutput(result));
  const outputText = $derived(
    typeof output === "string" ? output : output ? JSON.stringify(output, null, 2) : "",
  );
  const failed = $derived(
    result?.content?.kind === "tool_result" && (result.content as { isError?: boolean }).isError,
  );
</script>

<BlockShell
  icon={block.completed ? WrenchIcon : CircleNotchIcon}
  title={block.toolName ?? "tool"}
  tone={block.completed ? "blue" : "amber"}
  status={block.completed ? undefined : "streaming"}
>
  <pre class="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-muted">{serialized ??
      ""}</pre>
  {#if outputText.length > 0}
    <pre
      class="max-h-72 overflow-auto border-t border-line-faint px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap {failed
        ? 'text-red'
        : 'text-muted'}">{outputText}</pre>
  {/if}
</BlockShell>
