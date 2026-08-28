<script lang="ts">
	import type { SessionView } from '@nib-ui/protocol';
	import type { PaneFrame, PaneNode } from '@nib-ui/ui-contracts';
	import { kernelContext } from '@nib-ui/ui-contracts/svelte';
	import { listLeaves, minimumFraction, resizeSiblings, type NodePath } from '../layout/frames';
	import type { ReactivePaneRegistry } from '../registries/panes.svelte';
	import PaneLeaf from './PaneLeaf.svelte';
	import PaneNodeView from './PaneNodeView.svelte';

	const {
		node,
		frame,
		path,
		session,
	}: { node: PaneNode; frame: PaneFrame; path: NodePath; session: SessionView | null } = $props();

	const panes = kernelContext().require('panes') as ReactivePaneRegistry;

	let width = $state(0);
	let height = $state(0);
	/** Pixels along the split's own axis, which is what a drag fraction is taken against. */
	const extent = $derived(node.kind === 'split' && node.axis === 'row' ? width : height);

	let splitter = $state<{ index: number; pointer: number } | null>(null);

	function start(event: PointerEvent, index: number) {
		if (event.button !== 0 || node.kind !== 'split') return;
		event.preventDefault();
		event.stopPropagation();
		splitter = { index, pointer: node.axis === 'row' ? event.clientX : event.clientY };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function track(event: PointerEvent) {
		if (!splitter || node.kind !== 'split' || extent <= 0) return;
		const pointer = node.axis === 'row' ? event.clientX : event.clientY;
		const minimum = minimumFraction(node.axis, extent, node.children.length);
		panes.setSplitSizes(
			frame.frameId,
			path,
			resizeSiblings(node.sizes, splitter.index, (pointer - splitter.pointer) / extent, minimum),
		);
		splitter = { index: splitter.index, pointer };
	}

	/** Stable across an insert, so a pane is not torn down when a sibling arrives. */
	function keyOf(child: PaneNode, index: number): string {
		return listLeaves(child)[0] ?? `slot-${index}`;
	}
</script>

{#if node.kind === 'leaf'}
	<PaneLeaf instanceId={node.instanceId} {frame} {session} />
{:else}
	<div
		bind:clientWidth={width}
		bind:clientHeight={height}
		class="flex min-h-0 min-w-0 flex-1 {node.axis === 'row' ? 'flex-row' : 'flex-col'}"
	>
		{#each node.children as child, index (keyOf(child, index))}
			<div class="flex min-h-0 min-w-0 overflow-hidden" style="flex: {node.sizes[index] ?? 1} 1 0;">
				<PaneNodeView node={child} {frame} path={[...path, index]} {session} />
			</div>
			{#if index < node.children.length - 1}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					role="separator"
					aria-orientation={node.axis === 'row' ? 'vertical' : 'horizontal'}
					class="shrink-0 bg-line hover:bg-line-strong {node.axis === 'row'
						? 'w-1 cursor-col-resize'
						: 'h-1 cursor-row-resize'}"
					onpointerdown={(event) => start(event, index)}
					onpointermove={track}
					onpointerup={() => (splitter = null)}
					onpointercancel={() => (splitter = null)}
				></div>
			{/if}
		{/each}
	</div>
{/if}
