<script lang="ts">
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import { assetUrl } from '@nib-ui/plugin-canvas-media';
	import type { PaneProps } from '@nib-ui/ui-contracts';
	import { orbitAfterDrag, orbitAfterWheel } from './model';
	import { ModelScene } from './ModelScene';
	import { modelViewerState } from './viewer.svelte';

	// The window shows whatever the board last opened, so it needs no session.
	const {}: PaneProps = $props();

	/** Past this the buffer costs more than the extra sharpness is worth. */
	const MAX_RESOLUTION = 2;

	let host = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let height = $state(0);
	let status = $state<'empty' | 'loading' | 'ready' | 'failed'>('empty');
	let scene: ModelScene | null = null;
	let drag: { pointerX: number; pointerY: number } | null = null;
	let loadToken = 0;

	const model = $derived(modelViewerState.model);

	$effect(() => {
		const current = model;
		if (!current) {
			loadToken += 1;
			release();
			status = 'empty';
			return;
		}

		const token = (loadToken += 1);
		status = 'loading';
		const next = new ModelScene();
		void next
			.load(assetUrl(current.assetId), current.format)
			.catch((cause: unknown) => {
				// The window can only say that it failed; the reason has to be readable somewhere.
				console.warn(`canvas-3d: ${current.name ?? current.assetId} could not be opened`, cause);
				return false;
			})
			.then((loaded) => {
				if (token !== loadToken) return next.dispose();
				release();
				if (!loaded) {
					next.dispose();
					status = 'failed';
					return;
				}
				scene = next;
				status = 'ready';
				mount(next);
				draw();
			});
	});

	// Tracked so a resized window and a turned model both reach the same frame call.
	$effect(() => {
		modelViewerState.orbit;
		void width;
		void height;
		draw();
	});

	$effect(() => () => {
		loadToken += 1;
		release();
	});

	function release() {
		scene?.dispose();
		scene = null;
		host?.replaceChildren();
	}

	function mount(active: ModelScene) {
		active.canvas.className = 'block h-full w-full';
		host?.replaceChildren(active.canvas);
	}

	function draw() {
		const active = scene;
		if (!active || width <= 0 || height <= 0) return;
		active.resize(width, height, Math.min(MAX_RESOLUTION, Math.max(1, globalThis.devicePixelRatio || 1)));
		active.render(modelViewerState.orbit);
	}

	function startDrag(event: PointerEvent) {
		if (event.button !== 0 || status !== 'ready') return;
		event.preventDefault();
		drag = { pointerX: event.clientX, pointerY: event.clientY };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	/** Deltas are taken against the last position, so the turn survives a clamped pitch. */
	function track(event: PointerEvent) {
		if (!drag) return;
		modelViewerState.orbit = orbitAfterDrag(
			modelViewerState.orbit,
			event.clientX - drag.pointerX,
			event.clientY - drag.pointerY,
			event.shiftKey,
		);
		drag = { pointerX: event.clientX, pointerY: event.clientY };
	}

	// Registered by hand rather than as an attribute: the page must not scroll
	// behind the window, and only a non-passive listener may refuse that.
	$effect(() => {
		const element = host;
		if (!element) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			modelViewerState.orbit = orbitAfterWheel(modelViewerState.orbit, event.deltaY);
		};
		element.addEventListener('wheel', onWheel, { passive: false });
		return () => element.removeEventListener('wheel', onWheel);
	});
</script>

<div aria-label="3D model viewer" class="relative flex h-full min-h-0 flex-col">
	<div class="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
		<span class="min-w-0 flex-1 truncate text-xs text-default">{model?.name ?? '3D model'}</span>
		{#if model}
			<span class="shrink-0 text-2xs tracking-caps text-faint uppercase">{model.format}</span>
		{/if}
		<button
			type="button"
			class="shrink-0 rounded-md p-1 text-faint hover:bg-hover hover:text-default disabled:opacity-40"
			aria-label="Reset the view"
			disabled={status !== 'ready'}
			onclick={() => modelViewerState.resetOrbit()}
		>
			<ArrowCounterClockwiseIcon size={12} />
		</button>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={host}
		bind:clientWidth={width}
		bind:clientHeight={height}
		class="relative min-h-0 flex-1 touch-none {status === 'ready' ? 'cursor-grab' : ''}"
		onpointerdown={startDrag}
		onpointermove={track}
		onpointerup={() => (drag = null)}
		onpointercancel={() => (drag = null)}
	></div>

	{#if status !== 'ready'}
		<p class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-dim">
			{#if status === 'empty'}
				Double-click a model on the board to open it here.
			{:else if status === 'loading'}
				Loading…
			{:else}
				This model could not be loaded.
			{/if}
		</p>
	{/if}

	<p class="border-t border-line px-2.5 py-1 text-2xs text-faint">Drag to turn · shift-drag or wheel to zoom</p>
</div>
