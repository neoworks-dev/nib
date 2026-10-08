<script lang="ts">
  import type { ToolItem } from "@nib-ui/protocol";
  import type { RendererProps } from "@nib-ui/ui-contracts";

  const { item }: RendererProps<ToolItem> = $props();
  let showRaw = $state(false);
  const content = $derived({ rawInput: item.rawInput, rawOutput: item.rawOutput });
</script>

<div class="rounded-md border border-line bg-raised">
  <div class="flex items-center gap-2 border-b border-line-faint px-3 py-1.5 text-xs">
    <span class="tracking-caps uppercase text-dim">Unrendered tool call</span>
    <span class="font-mono text-default">{item.kind}</span>
    {#if item.name}
      <span class="font-mono text-muted">{item.name}</span>
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
      showRaw ? item : content,
      null,
      2,
    )}</pre>
</div>
