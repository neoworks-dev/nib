<script lang="ts">
  import type { SlotProps } from "@nib-ui/ui-contracts";
  import LightningIcon from "phosphor-svelte/lib/LightningIcon";

  const { session }: SlotProps = $props();

  const usage = $derived(session?.usage ?? null);
  /** Cents are as fine as a person reads a bill; under one cent it says so. */
  const cost = $derived.by(() => {
    if (!usage) return "$0.00";
    if (usage.costUsd > 0 && usage.costUsd < 0.01) return "<$0.01";
    return `$${usage.costUsd.toFixed(2)}`;
  });
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
    class="flex h-7 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-muted tabular-nums"
    title={breakdown}
  >
    <span class="text-amber"><LightningIcon size={14} /></span>
    {cost}
  </span>
{/if}
