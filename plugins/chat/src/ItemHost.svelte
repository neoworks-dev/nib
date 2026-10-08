<script lang="ts">
  import type { MessageItem, SessionView, ToolItem } from "@nib-ui/protocol";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";

  const {
    item,
    session,
    detail = false,
  }: { item: MessageItem | ToolItem; session: SessionView; detail?: boolean } = $props();

  const renderers = kernelContext().require("renderers");
  const ToolRenderer = $derived(item.type === "tool" ? renderers.resolveTool(item) : null);
  const MessageRenderer = $derived(item.type === "tool" ? null : renderers.resolveMessage(item));
</script>

{#if item.type === "tool" && ToolRenderer}
  <ToolRenderer {item} {session} {detail} />
{:else if item.type !== "tool" && MessageRenderer}
  <MessageRenderer {item} {session} {detail} />
{:else}
  <pre class="rounded-md border border-line bg-raised px-3 py-2 font-mono text-xs">{JSON.stringify(
      item,
      null,
      2,
    )}</pre>
{/if}
