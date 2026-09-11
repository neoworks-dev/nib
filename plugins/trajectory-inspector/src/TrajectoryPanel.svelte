<script lang="ts">
  import type { SlotProps } from "@nib-ui/ui-contracts";
  import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";
  import PulseIcon from "phosphor-svelte/lib/PulseIcon";
  import XIcon from "phosphor-svelte/lib/XIcon";
  import DetailPane from "./DetailPane.svelte";
  import { categorizeEvent, eventCategories, indexBlockKinds } from "./filter";
  import { inspectorState } from "./state.svelte";
  import TimelineStrip from "./TimelineStrip.svelte";
  import TraceRow from "./TraceRow.svelte";
  import { buildTimeline, markIndex, withinRange } from "./timeline";
  import { buildTrace, type TraceNode } from "./trace";

  const { session }: SlotProps = $props();

  const events = $derived(
    session ? (inspectorState.sessions?.events(session.sessionId) ?? []) : [],
  );
  const blockKinds = $derived(indexBlockKinds(events));
  const trace = $derived(buildTrace(events));
  const marks = $derived(markIndex(buildTimeline(trace)));
  const visible = $derived(trace.filter(matches));
  const selected = $derived(
    visible.find((node) => node.id === inspectorState.selectedEventId) ?? null,
  );

  function matches(node: TraceNode): boolean {
    if (!withinRange(marks.get(node.id), inspectorState.range)) return false;

    const categories = inspectorState.categories;
    if (
      categories.length > 0 &&
      !node.events.some((event) => categories.includes(categorizeEvent(event, blockKinds)))
    )
      return false;

    const query = inspectorState.query.trim().toLowerCase();
    if (query.length === 0) return true;
    return `${node.badge} ${node.title} ${node.detail} ${node.result ?? ""}`
      .toLowerCase()
      .includes(query);
  }
</script>

<button
  type="button"
  class="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-dim hover:border-line-strong hover:text-default"
  onclick={() => inspectorState.toggle()}
>
  <PulseIcon size={14} />
  Trajectory
  <span class="tabular-nums text-faint">{events.length}</span>
</button>

{#if inspectorState.open}
  <button
    type="button"
    aria-label="Close the trajectory inspector"
    class="fixed inset-0 z-modal cursor-default"
    style="background: var(--overlay-scrim)"
    onclick={() => inspectorState.toggle(false)}
  ></button>
  <aside
    class="fixed inset-8 z-modal flex flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-lg"
  >
    <header class="flex items-center gap-2 border-b border-line px-4 py-3">
      <h2 class="text-sm font-semibold">Trajectory</h2>
      <span class="text-2xs text-faint tabular-nums"
        >{visible.length}/{trace.length} steps · {events.length} events</span
      >
      <button
        type="button"
        class="ml-auto text-dim hover:text-default"
        aria-label="Close the trajectory inspector"
        onclick={() => inspectorState.toggle(false)}
      >
        <XIcon size={16} />
      </button>
    </header>

    <TimelineStrip
      nodes={trace}
      range={inspectorState.range}
      selectedId={inspectorState.selectedEventId}
      onbrush={(range) => (inspectorState.range = range)}
      onselect={(nodeId) => (inspectorState.selectedEventId = nodeId)}
    />

    <div class="flex flex-col gap-2 border-b border-line px-4 py-2">
      <div class="flex items-center gap-2 rounded-md border border-line bg-input px-2 py-1.5">
        <span class="text-faint"><MagnifyingGlassIcon size={14} /></span>
        <input
          bind:value={inspectorState.query}
          placeholder="Search steps, payloads and results"
          class="min-w-0 flex-1 bg-transparent text-xs text-default placeholder:text-faint focus:outline-none"
        />
        {#if inspectorState.query}
          <button
            type="button"
            class="text-faint hover:text-default"
            aria-label="Clear the search"
            onclick={() => (inspectorState.query = "")}
          >
            <XIcon size={12} />
          </button>
        {/if}
      </div>

      <div class="flex flex-wrap gap-1.5">
        {#each eventCategories as category (category.id)}
          <button
            type="button"
            class="rounded-full border px-2 py-0.5 text-2xs {inspectorState.categories.includes(
              category.id,
            )
              ? 'border-action bg-raised text-default'
              : 'border-line text-dim hover:text-default'}"
            onclick={() => inspectorState.toggleCategory(category.id)}
          >
            {category.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto font-mono text-2xs">
      {#each visible as node (node.id)}
        <TraceRow
          {node}
          selected={node.id === inspectorState.selectedEventId}
          onselect={() =>
            (inspectorState.selectedEventId =
              inspectorState.selectedEventId === node.id ? null : node.id)}
        />
      {/each}
      {#if visible.length === 0}
        <p class="px-4 py-3 font-sans text-xs text-dim">
          {events.length === 0
            ? "No events recorded for this session yet."
            : "No steps match the filter."}
        </p>
      {/if}
    </div>

    {#if selected}
      <div class="flex h-[45%] min-h-0 flex-col">
        <DetailPane node={selected} />
      </div>
    {/if}
  </aside>
{/if}
