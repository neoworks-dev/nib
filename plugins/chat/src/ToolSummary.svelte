<script lang="ts">
  import type { SessionView } from "@nib-ui/protocol";
  import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
  import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
  import { slide } from "svelte/transition";
  import ItemHost from "./ItemHost.svelte";
  import ToolGroup from "./ToolGroup.svelte";
  import type { ToolSummary } from "./tool-groups";

  /**
   * A finished turn's tool work as one line naming what ran. Opening it brings
   * back the groups and thoughts exactly as they were shown while they ran.
   */
  const { summary, session }: { summary: ToolSummary; session: SessionView } = $props();

  let open = $state(false);
</script>

<section class="flex flex-col gap-1">
  <button
    type="button"
    class="flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm text-dim hover:bg-hover hover:text-default"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span>{summary.line}</span>
    {#if open}
      <CaretDownIcon size={14} />
    {:else}
      <CaretRightIcon size={14} />
    {/if}
  </button>

  {#if open}
    <div class="flex flex-col gap-2" transition:slide={{ duration: 120 }}>
      {#each summary.entries as entry (entry.kind === "group" ? entry.group.id : entry.item.id)}
        {#if entry.kind === "group"}
          <ToolGroup group={entry.group} {session} />
        {:else}
          <ItemHost item={entry.item} {session} />
        {/if}
      {/each}
    </div>
  {/if}
</section>
