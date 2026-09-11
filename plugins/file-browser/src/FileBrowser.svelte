<script lang="ts">
  import type { PaneProps } from "@nib-ui/ui-contracts";
  import ArrowsClockwiseIcon from "phosphor-svelte/lib/ArrowsClockwiseIcon";
  import { fileBrowserState } from "./state.svelte";
  import TreeNode from "./TreeNode.svelte";
  import { fetchTree, type TreeEntry } from "./tree";

  const { session }: PaneProps = $props();

  let entries = $state<TreeEntry[]>([]);
  let error = $state<string | null>(null);
  let activePath = $state<string | null>(null);

  const sessionId = $derived(session?.sessionId ?? null);
  const workspace = $derived(session?.cwd?.slice(session.cwd.lastIndexOf("/") + 1) ?? "");

  $effect(() => {
    // The tree carries git status, so it refreshes as the agent edits files.
    if (!sessionId) return;
    session?.lastSeq;
    void load(sessionId);
  });

  async function load(id: string) {
    try {
      entries = (await fetchTree(id, "")).entries;
      error = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function open(path: string) {
    activePath = path;
    if (sessionId) void fileBrowserState.viewer?.open(sessionId, path);
  }
</script>

{#if sessionId}
  <section class="flex min-h-0 flex-1 flex-col">
    <header class="flex items-center gap-1.5 px-2 py-1">
      <span class="truncate text-2xs tracking-caps uppercase text-dim">{workspace || "Files"}</span>
      <button
        type="button"
        class="ml-auto text-faint hover:text-default"
        aria-label="Refresh the file tree"
        onclick={() => sessionId && load(sessionId)}
      >
        <ArrowsClockwiseIcon size={12} />
      </button>
    </header>

    {#if error}
      <p class="px-2 py-1 text-2xs text-red">{error}</p>
    {/if}

    <div class="min-h-0 flex-1 overflow-y-auto">
      {#each entries as entry (entry.path)}
        <TreeNode {entry} {sessionId} depth={0} {activePath} onopen={open} />
      {/each}
      {#if entries.length === 0 && !error}
        <p class="px-2 py-1 text-2xs text-faint">Nothing to show.</p>
      {/if}
    </div>
  </section>
{:else}
  <p class="px-2 py-2 text-xs text-dim">Open a task to browse its files.</p>
{/if}
