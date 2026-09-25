<script lang="ts">
  import type { PaneProps } from "@nib-ui/ui-contracts";
  import ArrowsClockwiseIcon from "phosphor-svelte/lib/ArrowsClockwiseIcon";
  import { projectExplorerState } from "./state.svelte";
  import TreeNode from "./TreeNode.svelte";
  import { fetchTree, type TreeEntry } from "./tree";

  // The tree is the project's, not a conversation's, so the pane's session is
  // never read: the board on screen is what decides which directory this shows.
  // oxlint-disable-next-line no-empty-pattern
  const {}: PaneProps = $props();

  let entries = $state<TreeEntry[]>([]);
  let error = $state<string | null>(null);
  let activePath = $state<string | null>(null);
  let token = $state(0);

  const cwd = $derived(projectExplorerState.cwd);
  const name = $derived(cwd.slice(cwd.lastIndexOf("/") + 1));

  $effect(() => {
    const directory = cwd;
    if (directory.length === 0) return;
    // Read so refreshing re-lists the root as well as the folders under it.
    token;
    let current = true;
    void (async () => {
      try {
        const listing = await fetchTree(directory, "");
        if (!current) return;
        entries = listing.entries;
        error = null;
      } catch (cause) {
        if (current) error = cause instanceof Error ? cause.message : String(cause);
      }
    })();
    return () => {
      current = false;
    };
  });

  function open(path: string) {
    activePath = path;
    void projectExplorerState.viewer?.openProjectFile(cwd, path);
  }
</script>

{#if cwd}
  <section class="flex min-h-0 flex-1 flex-col">
    <header class="flex items-center gap-1.5 px-2 py-1">
      <span class="truncate text-2xs tracking-caps uppercase text-dim" title={cwd}>{name}</span>
      <button
        type="button"
        class="ml-auto text-faint hover:text-default"
        aria-label="Refresh the project tree"
        onclick={() => (token += 1)}
      >
        <ArrowsClockwiseIcon size={12} />
      </button>
    </header>

    {#if error}
      <p class="px-2 py-1 text-2xs text-red">{error}</p>
    {/if}

    <!-- Folding state lives in the nodes, so the whole tree is rebuilt when the
         project changes rather than carrying another project's open folders. -->
    {#key cwd}
      <div class="min-h-0 flex-1 overflow-y-auto pb-2">
        {#each entries as entry (entry.path)}
          <TreeNode {entry} {cwd} depth={0} {activePath} {token} onopen={open} />
        {/each}
        {#if entries.length === 0 && !error}
          <p class="px-2 py-1 text-2xs text-faint">Nothing to show.</p>
        {/if}
      </div>
    {/key}
  </section>
{:else}
  <p class="px-2 py-2 text-xs text-dim">Open a project to browse its files.</p>
{/if}
