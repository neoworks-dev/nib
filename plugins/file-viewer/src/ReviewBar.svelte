<script lang="ts">
  import CheckIcon from "phosphor-svelte/lib/CheckIcon";
  import XIcon from "phosphor-svelte/lib/XIcon";
  import type { Verdict } from "./changes";

  const {
    range,
    verdict,
    ondecide,
  }: {
    range: [number, number];
    verdict: Verdict | null;
    ondecide: (verdict: Verdict) => void;
  } = $props();
</script>

<div class="flex items-center gap-2 border-y border-line-faint bg-surface px-3 py-1 text-2xs">
  <span class="text-dim">
    {range[0] === range[1] ? `Line ${range[0]}` : `Lines ${range[0]}–${range[1]}`}
  </span>

  {#if verdict}
    <span class="ml-auto {verdict === 'accepted' ? 'text-green' : 'text-red'}">
      {verdict === "accepted" ? "Accepted" : "Rejected"}
    </span>
  {:else}
    <span class="ml-auto flex items-center gap-1">
      <button
        type="button"
        class="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-dim hover:border-green hover:text-green"
        onclick={() => ondecide("accepted")}
      >
        <CheckIcon size={11} />
        Accept
      </button>
      <button
        type="button"
        class="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-dim hover:border-red hover:text-red"
        onclick={() => ondecide("rejected")}
      >
        <XIcon size={11} />
        Deny
      </button>
    </span>
  {/if}
</div>
