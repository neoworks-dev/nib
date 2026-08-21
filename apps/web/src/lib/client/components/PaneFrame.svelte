<script lang="ts">
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import type { SessionView } from '@nib-ui/protocol';
	import { clientContext } from '../context';
	import { paneDrag } from '../layout/drag.svelte';
	import { edgeFromPoint } from '../layout/tiles';
	import type { ReactivePaneRegistry } from '../registries/panes.svelte';
	import { chatPaneId } from '../registries/panes.svelte';

	const { paneId, session }: { paneId: string; session: SessionView | null } = $props();

	const panes = clientContext().require('panes') as ReactivePaneRegistry;

	let frame = $state<HTMLElement>();

	const definition = $derived(panes.definition(paneId));
	const dragging = $derived(paneDrag.paneId === paneId);
	const dropEdge = $derived(paneDrag.targetPaneId === paneId ? paneDrag.edge : null);

	function startDrag(event: PointerEvent) {
		// Alt is the modifier so a plain drag inside a pane still selects text.
		if (!event.altKey || event.button !== 0) return;
		event.preventDefault();
		paneDrag.start(paneId);
	}

	function trackPointer(event: PointerEvent) {
		if (!paneDrag.paneId || !frame) return;
		paneDrag.over(paneId, edgeFromPoint(frame.getBoundingClientRect(), event.clientX, event.clientY));
	}

	function drop() {
		const source = paneDrag.paneId;
		const edge = paneDrag.edge;
		if (source && edge && paneDrag.targetPaneId === paneId) panes.move(source, paneId, edge);
		paneDrag.clear();
	}
</script>

<section
	bind:this={frame}
	role="group"
	aria-label={definition?.title ?? paneId}
	class="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col border border-line bg-canvas {dragging ? 'opacity-60' : ''} {panes.focusedPaneId ===
	paneId
		? 'border-line-strong'
		: ''}"
	onpointerdown={startDrag}
	onpointermove={trackPointer}
	onpointerup={drop}
	onpointerenter={trackPointer}
>
	<header
		role="toolbar"
		aria-label="Move the {definition?.title ?? paneId} pane"
		tabindex="-1"
		class="flex shrink-0 cursor-grab items-center gap-2 border-b border-line bg-elevated px-3 py-1.5 select-none"
		onpointerdown={(event) => {
			paneDrag.start(paneId);
			event.preventDefault();
		}}
	>
		{#if definition?.icon}
			{@const Icon = definition.icon}
			<span class="text-dim"><Icon size={13} /></span>
		{/if}
		<span class="truncate text-2xs tracking-caps uppercase text-dim">{definition?.title ?? paneId}</span>
		{#if paneId !== chatPaneId}
			<button
				type="button"
				class="ml-auto text-faint hover:text-default"
				aria-label="Close the {definition?.title ?? paneId} pane"
				onclick={() => panes.close(paneId)}
			>
				<XIcon size={12} />
			</button>
		{/if}
	</header>

	<div class="min-h-0 min-w-0 flex-1 overflow-hidden" onfocusin={() => (panes.focusedPaneId = paneId)}>
		{#if definition}
			{@const Pane = definition.component}
			<Pane {session} />
		{:else}
			<p class="px-3 py-2 text-xs text-dim">No plugin provides the pane “{paneId}”.</p>
		{/if}
	</div>

	{#if dropEdge}
		<div
			class="pointer-events-none absolute border-2 border-action bg-hover/40 {dropEdge === 'left'
				? 'inset-y-0 left-0 w-1/2'
				: dropEdge === 'right'
					? 'inset-y-0 right-0 w-1/2'
					: dropEdge === 'top'
						? 'inset-x-0 top-0 h-1/2'
						: 'inset-x-0 bottom-0 h-1/2'}"
		></div>
	{/if}
</section>
