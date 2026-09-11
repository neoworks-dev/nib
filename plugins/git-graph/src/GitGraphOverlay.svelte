<script lang="ts">
  import { StatusBadge } from "@neoworks-dev/ui";
  import type { SlotProps } from "@nib-ui/ui-contracts";
  import ArrowsClockwiseIcon from "phosphor-svelte/lib/ArrowsClockwiseIcon";
  import GraphIcon from "phosphor-svelte/lib/GraphIcon";
  import XIcon from "phosphor-svelte/lib/XIcon";
  import { fetchLog, type GitLog, type GitLogEntry } from "./client";
  import { assignLanes, type GraphEdge, laneCount } from "./graph";
  import { gitGraphState } from "./state.svelte";

  const { session }: SlotProps = $props();

  const commitLimit = 200;
  const laneWidth = 14;
  const rowHeight = 26;
  const dotRadius = 3.5;
  const laneColours = [
    "var(--ctx-blue)",
    "var(--ctx-violet)",
    "var(--ctx-green)",
    "var(--ctx-amber)",
    "var(--ctx-red)",
  ];

  let log = $state<GitLog | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let requestToken = 0;

  const sessionId = $derived(session?.sessionId ?? null);
  const rows = $derived(assignLanes<GitLogEntry>(log?.commits ?? []));
  const graphWidth = $derived(laneCount(rows) * laneWidth);
  const columns = $derived(`${graphWidth}px minmax(0, 1fr) 9.5rem 9rem 5rem`);

  $effect(() => {
    if (!gitGraphState.open || !sessionId) return;
    void loadLog(sessionId);
  });

  async function loadLog(id: string) {
    const token = (requestToken += 1);
    loading = true;
    try {
      const result = await fetchLog(id, commitLimit);
      if (token !== requestToken) return;
      log = result;
      error = null;
    } catch (cause) {
      if (token === requestToken) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (token === requestToken) loading = false;
    }
  }

  function laneCentre(lane: number): number {
    return lane * laneWidth + laneWidth / 2;
  }

  function edgePath(edge: GraphEdge): string {
    const from = laneCentre(edge.fromLane);
    const to = laneCentre(edge.toLane);
    const middle = rowHeight / 2;
    if (edge.kind === "straight") return `M ${from},0 L ${to},${rowHeight}`;
    if (edge.kind === "merge")
      return `M ${from},0 C ${from},${middle * 0.6} ${to},${middle * 0.4} ${to},${middle}`;
    return `M ${from},${middle} C ${from},${middle * 1.4} ${to},${middle * 1.6} ${to},${rowHeight}`;
  }

  function laneColour(colourIndex: number): string {
    return laneColours[colourIndex % laneColours.length]!;
  }

  /** Author dates are ISO-8601 in the author's own offset; slicing keeps that reading. */
  function formatDate(isoDate: string): string {
    if (isoDate.length < 16) return isoDate;
    return `${isoDate.slice(0, 10)} ${isoDate.slice(11, 16)}`;
  }

  function refTone(ref: string): "violet" | "neutral" | "blue" {
    if (ref === "HEAD") return "violet";
    return ref.includes("/") ? "neutral" : "blue";
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape" && gitGraphState.open) gitGraphState.toggle(false);
  }}
/>

<button
  type="button"
  class="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-dim hover:border-line-strong hover:text-default"
  onclick={() => gitGraphState.toggle()}
>
  <GraphIcon size={14} />
  Graph
</button>

{#if gitGraphState.open}
  <section
    class="fixed inset-8 z-modal flex flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-lg"
  >
    <header class="flex items-center gap-2 border-b border-line px-4 py-3">
      <GraphIcon size={16} />
      <h2 class="text-sm font-semibold">Git Graph</h2>
      {#if log && log.commits.length > 0}
        <span class="text-2xs text-faint">{log.commits.length} commits</span>
      {/if}
      <span class="ml-auto flex items-center gap-3">
        {#if loading}
          <span class="text-2xs text-faint">Loading…</span>
        {/if}
        <button
          type="button"
          class="text-dim hover:text-default"
          aria-label="Refresh the commit graph"
          onclick={() => sessionId && loadLog(sessionId)}
        >
          <ArrowsClockwiseIcon size={14} />
        </button>
        <button
          type="button"
          class="text-dim hover:text-default"
          aria-label="Close the git graph"
          onclick={() => gitGraphState.toggle(false)}
        >
          <XIcon size={16} />
        </button>
      </span>
    </header>

    {#if error}
      <p class="border-b border-line px-4 py-2 text-xs text-red">{error}</p>
    {/if}

    {#if log && !log.repository}
      <p class="px-4 py-3 text-xs text-dim">This workspace is not a git repository.</p>
    {:else if log && log.commits.length === 0}
      <p class="px-4 py-3 text-xs text-dim">This repository has no commits yet.</p>
    {:else}
      <div
        class="grid items-center gap-3 border-b border-line px-3 py-1.5 text-2xs tracking-caps uppercase text-faint"
        style="grid-template-columns: {columns}"
      >
        <span></span>
        <span>Description</span>
        <span>Date</span>
        <span>Author</span>
        <span>Commit</span>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        {#each rows as row (row.commit.hash)}
          <button
            type="button"
            class="grid w-full items-center gap-3 px-3 text-left text-xs {gitGraphState.selectedHash ===
            row.commit.hash
              ? 'bg-raised'
              : 'hover:bg-hover'}"
            style="grid-template-columns: {columns}; height: {rowHeight}px"
            onclick={() => (gitGraphState.selectedHash = row.commit.hash)}
          >
            <svg width={graphWidth} height={rowHeight} aria-hidden="true">
              {#each row.edges as edge, index (index)}
                <path
                  d={edgePath(edge)}
                  fill="none"
                  stroke={laneColour(edge.colourIndex)}
                  stroke-width="1.5"
                />
              {/each}
              <circle
                cx={laneCentre(row.lane)}
                cy={rowHeight / 2}
                r={dotRadius}
                fill={laneColour(row.colourIndex)}
              />
            </svg>
            <span class="flex min-w-0 items-center gap-1.5">
              {#each row.commit.refs as ref (ref)}
                <StatusBadge tone={refTone(ref)}>{ref}</StatusBadge>
              {/each}
              <span class="truncate text-default">{row.commit.subject}</span>
            </span>
            <span class="truncate tabular-nums text-dim">{formatDate(row.commit.authorDate)}</span>
            <span class="truncate text-dim">{row.commit.authorName}</span>
            <span class="font-mono text-2xs text-faint">{row.commit.shortHash}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>
{/if}
