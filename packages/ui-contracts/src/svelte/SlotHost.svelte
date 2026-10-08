<script lang="ts">
  import type { AgentTurn, SessionView } from "@nib-ui/protocol";
  import type { SlotName } from "../index";
  import { kernelContext } from "./context";

  const {
    slot,
    session,
    turn,
    class: className = "",
  }: {
    slot: SlotName;
    session: SessionView | null;
    turn?: AgentTurn;
    class?: string;
  } = $props();

  const slots = kernelContext().require("slots");
  const entries = $derived(slots.entries(slot, session));
</script>

{#if entries.length > 0}
  <div class={className}>
    {#each entries as entry, index (index)}
      {@const Contribution = entry.component}
      <Contribution {session} {turn} />
    {/each}
  </div>
{/if}
