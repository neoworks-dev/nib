<script lang="ts">
  import type { PaneProps } from "@nib-ui/ui-contracts";
  import ArrowLineDownIcon from "phosphor-svelte/lib/ArrowLineDownIcon";
  import ArrowLineUpIcon from "phosphor-svelte/lib/ArrowLineUpIcon";
  import GraphIcon from "phosphor-svelte/lib/GraphIcon";
  import LightbulbIcon from "phosphor-svelte/lib/LightbulbIcon";
  import { canvasState } from "./state.svelte";

  // The pane takes no session: the vault belongs to the project, not a chat.
  const {}: PaneProps = $props();

  const vault = canvasState.vault;

  /**
   * The selection is the subject. Only a vault card has links — a workstream or a
   * picture is not in the vault — so anything else reads as nothing selected.
   */
  const path = $derived.by(() => {
    const selected = canvasState.registry.selection;
    if (selected.length !== 1) return null;
    const id = selected[0];
    if (id === undefined) return null;
    return vault.objectFor(id)?.path ?? null;
  });

  const summary = $derived(path === null ? null : vault.links(path));
  const unresolved = $derived(summary?.outgoing.filter((link) => link.to === null) ?? []);
  const resolved = $derived(summary?.outgoing.filter((link) => link.to !== null) ?? []);

  function name(itemPath: string): string {
    const base = itemPath.slice(itemPath.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(0, dot) : base;
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="flex items-center gap-2 border-b border-line px-4 py-3">
    <GraphIcon size={16} />
    <h2 class="text-sm font-semibold">Links</h2>
    {#if path}
      <span class="truncate text-xs text-dim" title={path}>{path}</span>
    {/if}
  </header>

  <div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-xs">
    {#if summary === null}
      <p class="text-dim">Select a note or a topic to see what it connects to.</p>
    {:else}
      <section class="space-y-1">
        <h3 class="flex items-center gap-1.5 font-semibold text-muted">
          <ArrowLineUpIcon size={12} />
          Links out
        </h3>
        {#each resolved as link (link.target)}
          <button
            type="button"
            class="block w-full truncate rounded px-1.5 py-1 text-left hover:bg-raised"
            onclick={() => link.to && vault.reveal(link.to)}
          >
            {name(link.to ?? link.target)}
            {#if link.ambiguous}
              <span class="text-dim" title="Several items answer to this name">· ambiguous</span>
            {/if}
          </button>
        {:else}
          <p class="px-1.5 text-dim">Nothing.</p>
        {/each}
      </section>

      {#if unresolved.length > 0}
        <section class="space-y-1">
          <h3 class="font-semibold text-muted">Points at nothing</h3>
          {#each unresolved as link (link.target)}
            <p class="truncate px-1.5 py-1 text-dim">[[{link.target}]]</p>
          {/each}
        </section>
      {/if}

      <section class="space-y-1">
        <h3 class="flex items-center gap-1.5 font-semibold text-muted">
          <ArrowLineDownIcon size={12} />
          Links in
        </h3>
        {#each summary.backlinks as source (source)}
          <button
            type="button"
            class="block w-full truncate rounded px-1.5 py-1 text-left hover:bg-raised"
            onclick={() => vault.reveal(source)}
          >
            {name(source)}
          </button>
        {:else}
          <p class="px-1.5 text-dim">Nothing points here.</p>
        {/each}
      </section>

      {#if summary.suggestions.length > 0 || summary.mentionedBy.length > 0}
        <section class="space-y-1">
          <h3 class="flex items-center gap-1.5 font-semibold text-muted">
            <LightbulbIcon size={12} />
            Mentioned, never linked
          </h3>
          {#each summary.suggestions as mention (mention.path)}
            <button
              type="button"
              class="block w-full truncate rounded px-1.5 py-1 text-left hover:bg-raised"
              onclick={() => vault.reveal(mention.path)}
            >
              says <span class="font-medium">{name(mention.path)}</span>
              <span class="text-dim">×{mention.count}</span>
            </button>
          {/each}
          {#each summary.mentionedBy as mention (mention.path)}
            <button
              type="button"
              class="block w-full truncate rounded px-1.5 py-1 text-left hover:bg-raised"
              onclick={() => vault.reveal(mention.path)}
            >
              <span class="font-medium">{name(mention.path)}</span> says this
              <span class="text-dim">×{mention.count}</span>
            </button>
          {/each}
        </section>
      {/if}
    {/if}
  </div>
</div>
