<script lang="ts">
	import type { SessionView } from '@nib-ui/protocol';
	import { kernelContext } from '@nib-ui/ui-contracts/svelte';
	import { paneDrag } from '../layout/pane-drag.svelte';
	import { snapRect } from '../layout/windows';
	import { rootPaneId, type ReactivePaneRegistry } from '../registries/panes.svelte';
	import PaneWindow from './PaneWindow.svelte';

	const { session }: { session: SessionView | null } = $props();

	const panes = kernelContext().require('panes') as ReactivePaneRegistry;

	const root = $derived(panes.definition(rootPaneId));
	/** The snap a drag is arming, drawn where the window would go. */
	const preview = $derived(paneDrag.snap ? snapRect(paneDrag.snap, panes.bounds) : null);

	let width = $state(0);
	let height = $state(0);

	$effect(() => {
		if (width > 0 && height > 0) panes.setBounds({ width, height });
	});
</script>

<div
	bind:clientWidth={width}
	bind:clientHeight={height}
	data-pane-host
	class="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-elevated"
>
	{#if root}
		{@const Root = root.component}
		<Root {session} instanceId={rootPaneId} />
	{:else}
		<p class="px-3 py-2 text-xs text-dim">No plugin provides the “{rootPaneId}” view.</p>
	{/if}

	{#each panes.frames as frame (frame.frameId)}
		<PaneWindow {frame} {session} />
	{/each}

	{#if preview}
		<!-- Where the window being dragged would land if it were let go here. -->
		<div
			class="pointer-events-none absolute z-overlay rounded-xl border-2 border-action bg-action/15"
			style="left:{preview.x}px; top:{preview.y}px; width:{preview.width}px; height:{preview.height}px;"
		></div>
	{/if}
</div>
