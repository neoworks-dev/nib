<script lang="ts">
  import { isToolSettled, toolInputString, toolOutputText, type ToolItem } from "@nib-ui/protocol";
  import type { RendererProps } from "@nib-ui/ui-contracts";
  import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
  import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
  import PlayIcon from "phosphor-svelte/lib/PlayIcon";
  import { stripAnsi } from "./ansi";

  const { item, detail = false }: RendererProps<ToolItem> = $props();

  let expanded = $state(false);
  const open = $derived(detail || expanded);

  const command = $derived.by(() => {
    const fromInput = toolInputString(item, "command", "cmd");
    if (fromInput !== undefined) return fromInput;
    return item.title;
  });
  const description = $derived(toolInputString(item, "description") ?? "");

  // What the command printed comes from its terminal reports; a harness that
  // reports no terminal leaves the result text.
  const text = $derived(stripAnsi(item.terminal ? item.terminal.output : toolOutputText(item)));
  const lines = $derived(text.length > 0 ? text.replace(/\n$/, "").split("\n") : []);
  const settled = $derived(isToolSettled(item));
  const failed = $derived.by(() => {
    if (item.status === "failed") return true;
    return (
      item.terminal !== null && item.terminal.exitCode !== null && item.terminal.exitCode !== 0
    );
  });
  const phase = $derived.by(() => {
    if (!settled) return "running";
    if (failed) return "failed";
    return "done";
  });
  const phaseTone = $derived(
    phase === "failed" ? "text-red" : phase === "done" ? "text-green" : "text-amber animate-pulse",
  );
</script>

<div
  class="overflow-hidden border border-line-faint bg-input font-mono {detail
    ? 'rounded-xl p-4 text-sm leading-relaxed'
    : 'rounded-lg text-xs'}"
>
  {#if !detail}
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
      onclick={() => (expanded = !expanded)}
    >
      <span class="shrink-0 text-green"><PlayIcon size={12} weight="fill" /></span>
      <span class="shrink-0 text-2xs tracking-caps uppercase text-dim">Ran</span>
      <span class="truncate text-default">{command || "…"}</span>
      <span class="ml-auto shrink-0 text-2xs {phaseTone}">{phase}</span>
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
    <div class={detail ? "" : "border-t border-line-faint px-3 py-2"}>
      <div class="flex gap-2">
        <span class="shrink-0 select-none text-dim">$</span>
        <span class="whitespace-pre-wrap text-default">{command}</span>
      </div>
      {#if description}
        <p class="mt-1 text-xs text-dim">{description}</p>
      {/if}
    </div>
    <div
      class="overflow-auto {detail
        ? 'mt-4 max-h-64'
        : 'max-h-96 border-t border-line-faint px-3 py-2'}"
    >
      {#each lines as line, index (index)}
        <div class="whitespace-pre-wrap {failed ? 'text-red' : 'text-dim'}">{line}</div>
      {/each}
      {#if lines.length === 0}
        <div class="text-dim">{settled ? "no output" : "waiting for output…"}</div>
      {/if}
    </div>
  {/if}
</div>
