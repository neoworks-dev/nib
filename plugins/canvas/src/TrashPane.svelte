<script lang="ts">
  /**
   * The recycling bin. Deleting a card files it here instead of unlinking it, so
   * this is where a delete is recovered from once the undo stack has moved on or
   * the window has been reloaded.
   *
   * `ListRow` and `Button` come from `@neoworks-dev/ui`; the header follows
   * `LinksPane`, which is the other pane the vault owns, rather than `SectionHeader`
   * — a pane title bar is not a section inside a page.
   */
  import type { PaneProps } from "@nib-ui/ui-contracts";
  import { Button, ListRow } from "@neoworks-dev/ui";
  import ArrowCounterClockwiseIcon from "phosphor-svelte/lib/ArrowCounterClockwiseIcon";
  import FolderIcon from "phosphor-svelte/lib/FolderIcon";
  import FileIcon from "phosphor-svelte/lib/FileIcon";
  import TrashIcon from "phosphor-svelte/lib/TrashIcon";
  import { canvasState } from "./state.svelte";

  // The bin belongs to the project's vault, not to any conversation about it, so
  // the session it is handed is never read.
  const { session: _session }: PaneProps = $props();

  const vault = canvasState.vault;
  const entries = $derived(vault.trash);

  // Read when the pane opens, and again whenever the project changes under it: the
  // bin is per project, and nothing else in the window is watching it.
  $effect(() => {
    void vault.cwd;
    void vault.loadTrash();
  });

  /** Deleted-at as something to read at a glance rather than a date to decode. */
  function when(deletedAt: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - deletedAt) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="flex items-center gap-2 border-b border-line px-4 py-3">
    <TrashIcon size={16} />
    <h2 class="text-sm font-semibold">Recycling bin</h2>
    <span class="ml-auto">
      {#if entries.length > 0}
        <Button size="sm" variant="ghost" onclick={() => void vault.purgeTrash()}>Empty</Button>
      {/if}
    </span>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
    {#each entries as entry (entry.id)}
      <ListRow title={entry.name} subtitle={`${entry.path} · ${when(entry.deletedAt)}`}>
        {#snippet leading()}
          {#if entry.kind === "topic"}
            <FolderIcon size={16} />
          {:else}
            <FileIcon size={16} />
          {/if}
        {/snippet}
        {#snippet trailing()}
          <span class="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={ArrowCounterClockwiseIcon}
              onclick={() => void vault.restoreFromTrash(entry.id)}
            >
              Put back
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={TrashIcon}
              onclick={() => void vault.purgeTrash(entry.id)}
            >
              Delete
            </Button>
          </span>
        {/snippet}
      </ListRow>
    {:else}
      <p class="p-2 text-dim">Nothing has been deleted from this project's vault.</p>
    {/each}
  </div>
</div>
