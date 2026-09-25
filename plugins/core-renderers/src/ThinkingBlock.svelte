<script lang="ts">
  import type { RendererProps } from "@nib-ui/ui-contracts";
  import BrainIcon from "phosphor-svelte/lib/BrainIcon";
  import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
  import CaretUpIcon from "phosphor-svelte/lib/CaretUpIcon";

  const { block }: RendererProps = $props();

  let expanded = $state(false);
  const text = $derived(block.text.trim());
  const preview = $derived(text.split("\n")[0] ?? "");
</script>

<!--
  Several models reason without ever emitting the reasoning. A finished thought
  with nothing in it is not a thought the person can open, so the transcript says
  the model is thinking only while it is, and nothing at all once it has stopped.
-->
{#if text.length === 0}
  {#if !block.completed}
    <div class="flex items-center gap-1.5 px-1 py-0.5 text-xs text-violet">
      <span class="animate-pulse"><BrainIcon size={14} /></span>
      <span class="animate-pulse">Thinking</span>
    </div>
  {/if}
{:else}
  <div class="flex min-w-0 flex-col gap-1">
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs text-muted hover:bg-hover hover:text-default"
      onclick={() => (expanded = !expanded)}
    >
      <span
        class="shrink-0"
        class:text-dim={block.completed}
        class:animate-pulse={!block.completed}
        class:text-violet={!block.completed}><BrainIcon size={14} /></span
      >
      <span class="shrink-0">{block.completed ? "Thought" : "Thinking"}</span>
      {#if !expanded}
        <span class="text-faint">·</span>
        <span class="truncate text-dim italic">{preview}</span>
      {/if}
      <span class="shrink-0 text-faint">
        {#if expanded}
          <CaretUpIcon size={12} />
        {:else}
          <CaretDownIcon size={12} />
        {/if}
      </span>
    </button>

    {#if expanded}
      <pre
        class="ml-2.5 max-h-80 overflow-auto border-l border-line pl-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-dim">{block.text}</pre>
    {/if}
  </div>
{/if}
