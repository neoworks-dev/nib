<script lang="ts">
  import { FileIcon } from "@nib-ui/file-icons";
  import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
  import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
  import FolderIcon from "phosphor-svelte/lib/FolderIcon";
  import FolderOpenIcon from "phosphor-svelte/lib/FolderOpenIcon";
  import TreeNode from "./TreeNode.svelte";
  import { fetchTree, statusMark, statusTone, type TreeEntry } from "./tree";

  const {
    entry,
    cwd,
    depth,
    activePath,
    token,
    onopen,
  }: {
    entry: TreeEntry;
    cwd: string;
    depth: number;
    activePath: string | null;
    /** Bumped by the pane to re-read what is open, without folding anything shut. */
    token: number;
    onopen: (path: string) => void;
  } = $props();

  let expanded = $state(false);
  let children = $state<TreeEntry[]>([]);
  let unreadable = $state(false);

  $effect(() => {
    if (!expanded) return;
    // Read so a refresh re-lists every folder the user has open.
    token;
    let current = true;
    void (async () => {
      try {
        const listing = await fetchTree(cwd, entry.path);
        if (!current) return;
        children = listing.entries;
        unreadable = false;
      } catch {
        if (current) unreadable = true;
      }
    })();
    return () => {
      current = false;
    };
  });

  function activate() {
    if (entry.directory) return void (expanded = !expanded);
    onopen(entry.path);
  }
</script>

<button
  type="button"
  class="flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-xs hover:bg-hover {activePath ===
  entry.path
    ? 'bg-raised'
    : ''}"
  style="padding-left: {6 + depth * 12}px"
  aria-expanded={entry.directory ? expanded : undefined}
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
    <span class="shrink-0 text-dim">
      {#if expanded}
        <FolderOpenIcon size={13} weight="fill" />
      {:else}
        <FolderIcon size={13} weight="fill" />
      {/if}
    </span>
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
  {#if unreadable}
    <p class="py-0.5 text-2xs text-faint" style="padding-left: {18 + depth * 12}px">
      Cannot read this folder.
    </p>
  {/if}
  {#each children as child (child.path)}
    <TreeNode entry={child} {cwd} depth={depth + 1} {activePath} {token} {onopen} />
  {/each}
{/if}
