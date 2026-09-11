<script lang="ts">
  import CaretDownIcon from "phosphor-svelte/lib/CaretDownIcon";
  import CaretRightIcon from "phosphor-svelte/lib/CaretRightIcon";
  import { untrack } from "svelte";
  import JsonNode from "./JsonNode.svelte";

  const {
    label,
    value,
    depth = 0,
  }: { label: string | null; value: unknown; depth?: number } = $props();

  const entries = $derived.by((): [string, unknown][] => {
    if (Array.isArray(value)) return value.map((entry, index) => [String(index), entry]);
    if (value !== null && typeof value === "object")
      return Object.entries(value as Record<string, unknown>);
    return [];
  });
  const branch = $derived(entries.length > 0);
  const preview = $derived(
    Array.isArray(value)
      ? `Array(${entries.length})`
      : branch
        ? `{${entries.length}}`
        : leaf(value),
  );

  // Depth only seeds the initial state; a moved node keeps whatever the user set.
  let expanded = $state(untrack(() => depth < 2));

  function leaf(input: unknown): string {
    if (typeof input === "string")
      return input.length > 200 ? `"${input.slice(0, 200)}…"` : `"${input}"`;
    if (input === null) return "null";
    if (input === undefined) return "undefined";
    if (typeof input === "object") return Array.isArray(input) ? "[]" : "{}";
    return String(input);
  }

  function tone(input: unknown): string {
    if (typeof input === "string") return "text-green";
    if (typeof input === "number") return "text-blue";
    if (typeof input === "boolean") return "text-violet";
    return "text-faint";
  }
</script>

<div style="padding-left: {depth === 0 ? 0 : 12}px">
  {#if branch}
    <button
      type="button"
      class="flex w-full items-center gap-1 py-px text-left hover:text-default"
      onclick={() => (expanded = !expanded)}
    >
      <span class="text-faint">
        {#if expanded}
          <CaretDownIcon size={10} />
        {:else}
          <CaretRightIcon size={10} />
        {/if}
      </span>
      {#if label !== null}
        <span class="text-muted">{label}</span>
      {/if}
      <span class="text-faint">{preview}</span>
    </button>
    {#if expanded}
      {#each entries as [key, child] (key)}
        <JsonNode label={key} value={child} depth={depth + 1} />
      {/each}
    {/if}
  {:else}
    <div class="flex gap-1 py-px">
      {#if label !== null}
        <span class="shrink-0 text-muted">{label}:</span>
      {/if}
      <span class="break-all {tone(value)}">{preview}</span>
    </div>
  {/if}
</div>
