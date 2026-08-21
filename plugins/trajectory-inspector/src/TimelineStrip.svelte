<script lang="ts">
	import type { TraceNode } from './trace';
	import { buildTimeline, fractionsOfRange, rangeFromFractions, type TimeRange, type TimelineLane } from './timeline';

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
		{ id: 'input', label: 'Input', tone: 'bg-blue' },
		{ id: 'model', label: 'Model', tone: 'bg-violet' },
		{ id: 'tools', label: 'Tools', tone: 'bg-amber' },
	];

	let track = $state<HTMLDivElement>();
	let anchor = $state<number | null>(null);
	let cursor = $state<number | null>(null);

	const timeline = $derived(buildTimeline(nodes));
	const brush = $derived(range ? fractionsOfRange(timeline, range) : null);
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
		else onbrush(rangeFromFractions(timeline, anchor, cursor));
		anchor = null;
		cursor = null;
	}

	function markTone(status: TraceNode['status'], tone: string): string {
		if (status === 'error') return 'bg-red';
		if (status === 'streaming') return 'bg-amber';
		return tone;
	}
</script>

<div class="flex flex-col gap-1.5 border-b border-line px-4 py-2">
	<div class="flex items-center gap-2 text-2xs text-faint">
		<span class="tabular-nums">{timeline.marks.length} steps · {seconds}s</span>
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
		<div class="flex w-12 shrink-0 flex-col justify-between py-0.5 text-2xs text-faint">
			{#each lanes as lane (lane.id)}
				<span class="leading-4">{lane.label}</span>
			{/each}
		</div>

		<div
			bind:this={track}
			role="slider"
			tabindex="0"
			aria-label="Session timeline"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={brush ? Math.round(brush.start * 100) : 0}
			class="relative min-w-0 flex-1 cursor-crosshair overflow-hidden rounded-md border border-line bg-input select-none"
			onpointerdown={startBrush}
			onpointermove={moveBrush}
			onpointerup={endBrush}
			onpointercancel={endBrush}
			onkeydown={(event) => {
				if (event.key === 'Escape') onbrush(null);
			}}
		>
			{#each lanes as lane (lane.id)}
				<div class="relative h-4 border-b border-line-faint last:border-b-0">
					{#each timeline.marks.filter((mark) => mark.lane === lane.id) as mark (mark.nodeId)}
						<button
							type="button"
							aria-label="Step at {Math.round(mark.start * 100)} percent"
							class="absolute top-1 h-2 rounded-xs {markTone(mark.status, lane.tone)} {selectedId === mark.nodeId
								? 'ring-1 ring-action'
								: ''}"
							style="left: {mark.start * 100}%; width: {(mark.end - mark.start) * 100}%; min-width: 3px"
							onclick={(event) => {
								event.stopPropagation();
								onselect(mark.nodeId);
							}}
						></button>
					{/each}
				</div>
			{/each}

			{#if timeline.marks.length === 0}
				<p class="absolute inset-0 flex items-center justify-center text-2xs text-faint">No steps yet.</p>
			{/if}

			{#if dragging}
				<div
					class="pointer-events-none absolute inset-y-0 border-x border-action bg-raised/50"
					style="left: {Math.min(anchor!, cursor!) * 100}%; width: {Math.abs(cursor! - anchor!) * 100}%"
				></div>
			{:else if brush}
				<div
					class="pointer-events-none absolute inset-y-0 border-x border-action bg-raised/40"
					style="left: {brush.start * 100}%; width: {(brush.end - brush.start) * 100}%"
				></div>
			{/if}
		</div>
	</div>
</div>
