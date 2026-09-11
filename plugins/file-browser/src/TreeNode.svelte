<script lang="ts">
  import { FileIcon } from "@nib-ui/file-icons";
  import { workspaceFileTransferType } from "@nib-ui/ui-contracts";
  import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
  import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
  import FolderIcon from "phosphor-svelte/lib/FolderIcon";
  import TreeNode from "./TreeNode.svelte";
  import { fetchTree, statusMark, statusTone, type TreeEntry } from "./tree";

  const {
    entry,
    sessionId,
    depth,
    activePath,
    onopen,
  }: {
    entry: TreeEntry;
    sessionId: string;
    depth: number;
    activePath: string | null;
    onopen: (path: string) => void;
  } = $props();

  let expanded = $state(false);
  let children = $state<TreeEntry[]>([]);

  $effect(() => {
    if (!expanded) return;
    let current = true;
    void fetchTree(sessionId, entry.path).then((listing) => {
      if (current) children = listing.entries;
    });
    return () => {
      current = false;
    };
  });

  function activate() {
    if (entry.directory) return void (expanded = !expanded);
    onopen(entry.path);
  }

  /**
   * The reference travels, not the bytes: whatever catches the drop reads the
   * file out of the workspace itself. The plain-text fallback is the `@path`
   * form a composer already understands.
   */
  function startDrag(event: DragEvent) {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.effectAllowed = "copy";
    transfer.setData(workspaceFileTransferType, JSON.stringify([{ sessionId, path: entry.path }]));
    transfer.setData("text/plain", `@${entry.path}`);
  }
</script>

<button
  type="button"
  class="flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-xs hover:bg-hover {activePath ===
  entry.path
    ? 'bg-raised'
    : ''}"
  style="padding-left: {6 + depth * 12}px"
  draggable={!entry.directory}
  ondragstart={startDrag}
  onclick={activate}
>
  {#if entry.directory}
    <span class="shrink-0 text-faint">
      {#if expanded}
        <CaretDownIcon size={10} />
      {:else}
        <CaretRightIcon size={10} />
      {/if}
    </span>
    <span class="shrink-0 text-dim"><FolderIcon size={13} /></span>
  {:else}
    <span class="w-2.5 shrink-0"></span>
    <FileIcon path={entry.path} size={13} />
  {/if}
  <span class="truncate {statusTone(entry.status)}">{entry.name}</span>
  {#if statusMark(entry.status)}
    <span class="ml-auto shrink-0 font-mono text-2xs {statusTone(entry.status)}"
      >{statusMark(entry.status)}</span
    >
  {/if}
</button>

{#if expanded}
  {#each children as child (child.path)}
    <TreeNode entry={child} {sessionId} depth={depth + 1} {activePath} {onopen} />
  {/each}
{/if}
