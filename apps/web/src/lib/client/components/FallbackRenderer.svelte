<script lang="ts">
  import type { RendererProps } from "@nib-ui/ui-contracts";

  const { block }: RendererProps = $props();
  let showRaw = $state(false);
  const content = $derived(block.content ?? { text: block.text, inputJson: block.inputJson });
</script>

<div class="rounded-md border border-line bg-raised">
  <div class="flex items-center gap-2 border-b border-line-faint px-3 py-1.5 text-xs">
    <span class="tracking-caps uppercase text-dim">Unrendered block</span>
    <span class="font-mono text-default">{block.kind}</span>
    {#if block.toolName}
      <span class="font-mono text-muted">{block.toolName}</span>
    {/if}
    <button
      type="button"
      class="ml-auto text-dim hover:text-default"
      onclick={() => (showRaw = !showRaw)}
    >
      {showRaw ? "hide raw" : "show raw"}
    </button>
  </div>
  <pre class="max-h-80 overflow-auto px-3 py-2 font-mono text-xs text-muted">{JSON.stringify(
      showRaw ? block : content,
      null,
      2,
    )}</pre>
</div>
