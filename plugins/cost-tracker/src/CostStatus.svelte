<script lang="ts">
  import type { SlotProps } from "@nib-ui/ui-contracts";
  import LightningIcon from "phosphor-svelte/lib/LightningIcon";

  const { session }: SlotProps = $props();

  const usage = $derived(session?.usage ?? null);
  const cost = $derived(usage ? usage.costUsd.toFixed(4) : "0.0000");
  // The title row has room for the number, not the breakdown behind it.
  const breakdown = $derived.by(() => {
    if (!usage) return "";
    const parts = [`${usage.inputTokens} in`, `${usage.outputTokens} out`];
    if (usage.cacheReadTokens > 0) parts.push(`${usage.cacheReadTokens} cached`);
    return `${parts.join(" · ")} tokens`;
  });
</script>

{#if usage}
  <span
    class="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-2xs text-dim"
    title={breakdown}
  >
    <span class="text-amber"><LightningIcon size={12} /></span>
    ${cost}
  </span>
{/if}
