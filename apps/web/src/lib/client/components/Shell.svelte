<script lang="ts">
	import { clientContext } from '../context';
	import { paneDrag } from '../layout/drag.svelte';
	import type { ReactivePaneRegistry } from '../registries/panes.svelte';
	import CommandPalette from './CommandPalette.svelte';
	import PaneLauncher from './PaneLauncher.svelte';
	import SessionHeader from './SessionHeader.svelte';
	import Sidebar from './Sidebar.svelte';
	import SlotHost from './SlotHost.svelte';
	import TileHost from './TileHost.svelte';

	const context = clientContext();
	const sessions = context.require('sessions');
	const panes = context.require('panes') as ReactivePaneRegistry;
	const session = $derived(sessions.active);

	$effect(() => {
		// A drag that ends outside every pane must not leave the layout armed.
		const cancel = () => paneDrag.clear();
		window.addEventListener('pointerup', cancel);
		window.addEventListener('pointercancel', cancel);
		return () => {
			window.removeEventListener('pointerup', cancel);
			window.removeEventListener('pointercancel', cancel);
		};
	});
</script>

<div class="grid h-screen grid-cols-[300px_1fr] bg-canvas text-default">
	<Sidebar />

	<main class="flex min-h-0 flex-col">
		{#if session}
			<SessionHeader {session} />
		{/if}

		<div class="flex min-h-0 flex-1 flex-col">
			{#if panes.layout}
				<TileHost node={panes.layout} {session} />
			{:else}
				<div class="flex flex-1 items-center justify-center text-sm text-dim">Every pane is closed.</div>
			{/if}
		</div>

		{#if paneDrag.paneId}
			<p class="border-t border-line bg-elevated px-4 py-1 text-2xs text-dim">
				Drop on a pane edge to tile — release outside to cancel.
			</p>
		{/if}

		<SlotHost
			slot="statusbar"
			{session}
			class="flex items-center gap-4 border-t border-line bg-elevated px-6 py-1.5 text-xs text-dim"
		/>
	</main>
</div>

<PaneLauncher />
<CommandPalette />
