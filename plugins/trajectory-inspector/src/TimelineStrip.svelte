<script lang="ts">
  import { buildTimeline, rangeFromFractions, type TimelineLane, type TimeRange } from "./timeline";
  import type { TraceNode } from "./trace";

  const {
    nodes,
    range,
    selectedId,
    onbrush,
    onselect,
  }: {
    nodes: TraceNode[];
    range: TimeRange | null;
    selectedId: string | null;
    onbrush: (range: TimeRange | null) => void;
    onselect: (nodeId: string) => void;
  } = $props();

  const lanes: { id: TimelineLane; label: string; tone: string }[] = [
    { id: "input", label: "Input", tone: "bg-blue" },
    { id: "model", label: "Model", tone: "bg-violet" },
    { id: "tools", label: "Tools", tone: "bg-amber" },
  ];

  let track = $state<HTMLDivElement>();
  let anchor = $state<number | null>(null);
  let cursor = $state<number | null>(null);

  const timeline = $derived(buildTimeline(nodes));
  const drawn = $derived(timeline.marks.filter((mark) => mark.lane !== null));
  const seconds = $derived(Math.round((timeline.to - timeline.from) / 100) / 10);
  const dragging = $derived(anchor !== null && cursor !== null);

  function fractionAt(clientX: number): number {
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function startBrush(event: PointerEvent) {
    anchor = fractionAt(event.clientX);
    cursor = anchor;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveBrush(event: PointerEvent) {
    if (anchor === null) return;
    cursor = fractionAt(event.clientX);
  }

  function endBrush() {
    if (anchor === null || cursor === null) return;
    // A click without a drag scrubs back out to the whole session.
    if (Math.abs(cursor - anchor) < 0.005) onbrush(null);
    else onbrush(rangeFromFractions(anchor, cursor));
    anchor = null;
    cursor = null;
  }

  function markTone(status: TraceNode["status"], tone: string): string {
    if (status === "error") return "bg-red";
    if (status === "streaming") return "bg-amber";
    return tone;
  }
</script>

<div class="flex flex-col gap-1.5 border-b border-line px-4 py-2">
  <div class="flex items-center gap-2 text-2xs text-faint">
    <span class="tabular-nums">{drawn.length} steps · {seconds}s elapsed · idle compressed</span>
    {#if range}
      <button
        type="button"
        class="rounded-full bg-raised px-2 py-0.5 text-muted hover:text-default"
        onclick={() => onbrush(null)}
      >
        range constrained — reset
      </button>
    {:else}
      <span>drag across the lanes to constrain the range</span>
    {/if}
  </div>

  <div class="flex items-stretch gap-2">
    <div class="flex w-12 shrink-0 flex-col py-px text-2xs text-faint">
      {#each lanes as lane (lane.id)}
        <span class="flex h-8 items-center">{lane.label}</span>
      {/each}
    </div>

    <div
      bind:this={track}
      role="slider"
      tabindex="0"
      aria-label="Session timeline"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={range ? Math.round(range.from * 100) : 0}
      class="relative min-w-0 flex-1 cursor-crosshair overflow-hidden rounded-md border border-line bg-input select-none"
      onpointerdown={startBrush}
      onpointermove={moveBrush}
      onpointerup={endBrush}
      onpointercancel={endBrush}
      onkeydown={(event) => {
        if (event.key === "Escape") onbrush(null);
      }}
    >
      {#each lanes as lane (lane.id)}
        <div class="relative h-8 border-b border-line-faint last:border-b-0">
          {#each timeline.marks.filter((mark) => mark.lane === lane.id) as mark (mark.nodeId)}
            <button
              type="button"
              aria-label="Step at {Math.round(mark.start * 100)} percent"
              class="absolute top-1.5 h-5 rounded-sm {markTone(
                mark.status,
                lane.tone,
              )} {selectedId === mark.nodeId ? 'ring-2 ring-action' : ''}"
              style="left: {mark.start * 100}%; width: {(mark.end - mark.start) *
                100}%; min-width: 8px"
              onclick={(event) => {
                event.stopPropagation();
                onselect(mark.nodeId);
              }}
            ></button>
          {/each}
        </div>
      {/each}

      {#if drawn.length === 0}
        <p class="absolute inset-0 flex items-center justify-center text-2xs text-faint">
          No steps yet.
        </p>
      {/if}

      {#if dragging}
        <div
          class="pointer-events-none absolute inset-y-0 border-x border-action bg-raised/50"
          style="left: {Math.min(anchor!, cursor!) * 100}%; width: {Math.abs(cursor! - anchor!) *
            100}%"
        ></div>
      {:else if range}
        <div
          class="pointer-events-none absolute inset-y-0 border-x border-action bg-raised/40"
          style="left: {range.from * 100}%; width: {(range.to - range.from) * 100}%"
        ></div>
      {/if}
    </div>
  </div>
</div>
