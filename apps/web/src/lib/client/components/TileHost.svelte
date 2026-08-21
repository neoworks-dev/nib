<script lang="ts">
	import type { SessionView } from '@nib-ui/protocol';
	import { clientContext } from '../context';
	import type { TileNode } from '../layout/tiles';
	import type { ReactivePaneRegistry } from '../registries/panes.svelte';
	import PaneFrame from './PaneFrame.svelte';
	import TileHost from './TileHost.svelte';

	const {
		node,
		session,
		path = [],
	}: { node: TileNode; session: SessionView | null; path?: number[] } = $props();

	const panes = clientContext().require('panes') as ReactivePaneRegistry;

	let container = $state<HTMLDivElement>();
	let resizing = $state(false);

	function startResize(event: PointerEvent) {
		resizing = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function resize(event: PointerEvent) {
		if (!resizing || !container || node.kind !== 'split') return;
		const rect = container.getBoundingClientRect();
		const ratio =
			node.direction === 'row' ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
		panes.resize(path, ratio);
	}
</script>

{#if node.kind === 'leaf'}
	<PaneFrame paneId={node.paneId} {session} />
{:else}
	<div
		bind:this={container}
		class="flex min-h-0 min-w-0 flex-1 {node.direction === 'row' ? 'flex-row' : 'flex-col'}"
	>
		<div class="flex min-h-0 min-w-0" style="flex: {node.ratio} 1 0%">
			<TileHost node={node.first} {session} path={[...path, 0]} />
		</div>

		<div
			role="separator"
			aria-orientation={node.direction === 'row' ? 'vertical' : 'horizontal'}
			class="shrink-0 bg-line hover:bg-action {node.direction === 'row' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}"
			onpointerdown={startResize}
			onpointermove={resize}
			onpointerup={() => (resizing = false)}
			onpointercancel={() => (resizing = false)}
		></div>

		<div class="flex min-h-0 min-w-0" style="flex: {1 - node.ratio} 1 0%">
			<TileHost node={node.second} {session} path={[...path, 1]} />
		</div>
	</div>
{/if}
