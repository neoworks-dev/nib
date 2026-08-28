<script lang="ts">
	import type { SessionView } from '@nib-ui/protocol';
	import type { PaneEdge, PaneFrame } from '@nib-ui/ui-contracts';
	import { kernelContext } from '@nib-ui/ui-contracts/svelte';
	import { frameChrome, listLeaves } from '../layout/frames';
	import { paneDrag } from '../layout/pane-drag.svelte';
	import { moveRect, resizeRect, snapAt, snapRect, type ResizeHandle } from '../layout/windows';
	import type { ReactivePaneRegistry } from '../registries/panes.svelte';
	import PaneNodeView from './PaneNodeView.svelte';

	const { frame, session }: { frame: PaneFrame; session: SessionView | null } = $props();

	const panes = kernelContext().require('panes') as ReactivePaneRegistry;

	const focused = $derived(panes.focusedFrameId === frame.frameId);
	/**
	 * A shared frame has no leaf whose header could stand for the whole window —
	 * every one of them means "take this pane out" — so it gets its own strip.
	 */
	const chrome = $derived(frameChrome(frame.root));
	const label = $derived(
		listLeaves(frame.root)
			.map((instanceId) => {
				const instance = panes.instance(instanceId);
				return (instance && panes.definition(instance.paneId)?.title) ?? instanceId;
			})
			.join(', '),
	);
	/** Exactly one edge, or none: the hint is where this frame would take the pane. */
	const hint = $derived<PaneEdge | null>(paneDrag.hint?.frameId === frame.frameId ? paneDrag.hint.edge : null);

	const hintClass: Record<PaneEdge, string> = {
		left: 'inset-y-0 left-0 w-1/3',
		right: 'inset-y-0 right-0 w-1/3',
		top: 'inset-x-0 top-0 h-1/3',
		bottom: 'inset-x-0 bottom-0 h-1/3',
	};

	/** Deltas are taken against the last pointer position, so the drag survives clamping. */
	let drag = $state<{ handle: ResizeHandle | 'move'; pointerX: number; pointerY: number } | null>(null);
	let element = $state<HTMLElement>();

	function startDrag(event: PointerEvent, handle: ResizeHandle | 'move') {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		panes.raiseFrame(frame.frameId);
		drag = { handle, pointerX: event.clientX, pointerY: event.clientY };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	/** Pointer in the coordinates the frame rects are in — the host's box, not the page. */
	function hostPoint(event: PointerEvent): { x: number; y: number } | null {
		const host = element?.closest('[data-pane-host]')?.getBoundingClientRect();
		return host ? { x: event.clientX - host.left, y: event.clientY - host.top } : null;
	}

	function track(event: PointerEvent) {
		if (!drag) return;
		const dx = event.clientX - drag.pointerX;
		const dy = event.clientY - drag.pointerY;
		panes.setFrameRect(
			frame.frameId,
			drag.handle === 'move'
				? moveRect(frame.rect, dx, dy, panes.bounds)
				: resizeRect(frame.rect, drag.handle, dx, dy, panes.bounds),
		);
		drag = { ...drag, pointerX: event.clientX, pointerY: event.clientY };

		// Only a move snaps: a resize is already saying where the edges go.
		if (drag.handle !== 'move') return;
		const point = hostPoint(event);
		paneDrag.snap = point ? snapAt(point.x, point.y, panes.bounds) : null;
	}

	/** The snap is taken on release, so a window dragged past an edge is not caught by it. */
	function endDrag() {
		const zone = drag?.handle === 'move' ? paneDrag.snap : null;
		if (zone) panes.setFrameRect(frame.frameId, snapRect(zone, panes.bounds));
		paneDrag.snap = null;
		drag = null;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
	bind:this={element}
	role="group"
	aria-label={label}
	class="absolute z-overlay flex flex-col overflow-hidden rounded-xl border bg-elevated shadow-2xl {focused
		? 'border-line-strong'
		: 'border-line'}"
	style="left:{frame.rect.x}px; top:{frame.rect.y}px; width:{frame.rect.width}px; height:{frame.rect.height}px;"
	onpointerdown={() => panes.raiseFrame(frame.frameId)}
	onfocusin={() => panes.raiseFrame(frame.frameId)}
>
	{#if chrome.frameBar}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex h-5 shrink-0 cursor-grab items-center gap-1.5 border-b border-line px-2.5 select-none"
			onpointerdown={(event) => startDrag(event, 'move')}
			onpointermove={track}
			onpointerup={endDrag}
			onpointercancel={endDrag}
		>
			<span class="min-w-0 flex-1 truncate text-2xs tracking-caps text-faint uppercase">{label}</span>
		</div>
	{/if}

	<PaneNodeView node={frame.root} {frame} path={[]} {session} />

	{#if hint}
		<div class="pointer-events-none absolute border-2 border-action bg-action/20 {hintClass[hint]}"></div>
	{/if}

	{#each [{ handle: 'right', class: 'inset-y-0 right-0 w-1.5 cursor-col-resize' }, { handle: 'bottom', class: 'inset-x-0 bottom-0 h-1.5 cursor-row-resize' }, { handle: 'corner', class: 'right-0 bottom-0 h-3 w-3 cursor-nwse-resize' }] as grip (grip.handle)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute {grip.class}"
			onpointerdown={(event) => startDrag(event, grip.handle as ResizeHandle)}
			onpointermove={track}
			onpointerup={endDrag}
			onpointercancel={endDrag}
		></div>
	{/each}
</section>
