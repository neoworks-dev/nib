<script lang="ts">
  import { FileIcon } from "@nib-ui/file-icons";
  import { isToolSettled, type ToolItem, toolDiffs } from "@nib-ui/protocol";
  import type { RendererProps } from "@nib-ui/ui-contracts";
  import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
  import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
  import { type DiffLine, diffLines } from "./diff";

  const { item, detail = false }: RendererProps<ToolItem> = $props();

  let expanded = $state(false);
  const open = $derived(detail || expanded);

  /** The diffs the call carries, each with its lines worked out. */
  const files = $derived(
    toolDiffs(item).map((diff) => {
      const lines = diffLines(diff.oldText ?? "", diff.newText);
      return {
        path: diff.path,
        created: diff.oldText === null,
        lines,
        added: countOf(lines, "added"),
        removed: countOf(lines, "removed"),
      };
    }),
  );
  const filePath = $derived.by(() => {
    if (files.length === 1) return files[0]!.path;
    if (files.length > 1) return `${files.length} files`;
    return item.locations[0]?.path ?? "unknown file";
  });
  const added = $derived(files.reduce((total, file) => total + file.added, 0));
  const removed = $derived(files.reduce((total, file) => total + file.removed, 0));
  const verb = $derived(files.length === 1 && files[0]!.created ? "Wrote" : "Updated");

  const phase = $derived.by(() => {
    if (item.status === "failed") return "failed";
    if (isToolSettled(item)) return "applied";
    return "pending";
  });
  const phaseTone = $derived.by(() => {
    if (phase === "failed") return "text-red";
    if (phase === "applied") return "text-green";
    return "text-amber animate-pulse";
  });

  function countOf(lines: DiffLine[], kind: DiffLine["kind"]): number {
    return lines.filter((line) => line.kind === kind).length;
  }

  const markers = { added: "+", removed: "-", context: " " } as const;
  const styles = {
    added: "bg-green-soft text-green",
    removed: "bg-red-soft text-red",
    context: "text-muted",
  } as const;
</script>

<div class="overflow-hidden rounded-lg border border-line-faint bg-input">
  {#if !detail}
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
      onclick={() => (expanded = !expanded)}
    >
      <FileIcon path={filePath} size={14} />
      <span class="shrink-0 text-2xs tracking-caps uppercase text-dim">{verb}</span>
      <span class="truncate font-mono text-xs text-default">{filePath}</span>
      <span class="ml-auto shrink-0 font-mono text-xs text-green">+{added}</span>
      <span class="shrink-0 font-mono text-xs text-red">-{removed}</span>
      <span class="shrink-0 text-2xs {phaseTone}">{phase}</span>
      <span class="shrink-0 text-faint">
        {#if expanded}
          <CaretDownIcon size={12} />
        {:else}
          <CaretRightIcon size={12} />
        {/if}
      </span>
    </button>
  {/if}

  {#if open}
    {#if files.length === 0}
      <p class="px-3 py-2 text-xs text-dim {detail ? '' : 'border-t border-line-faint'}">
        The harness has not reported the change yet…
      </p>
    {/if}
    {#each files as file (file.path)}
      <div
        class="max-h-96 overflow-auto font-mono text-xs {detail && files.length === 1
          ? ''
          : 'border-t border-line-faint'}"
      >
        {#if files.length > 1}
          <p class="px-3 py-1 text-2xs text-dim">{file.path}</p>
        {/if}
        {#each file.lines as line, index (index)}
          <div class="flex gap-2 px-3 py-px {styles[line.kind]}">
            <span class="select-none opacity-60">{markers[line.kind]}</span>
            <span class="whitespace-pre-wrap">{line.text}</span>
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>
