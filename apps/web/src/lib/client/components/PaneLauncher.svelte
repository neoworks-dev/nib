<script lang="ts">
	import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFourIcon';
	import { clientContext } from '../context';
	import { chatPaneId, type ReactivePaneRegistry } from '../registries/panes.svelte';

	const panes = clientContext().require('panes') as ReactivePaneRegistry;

	const available = $derived(panes.list().filter((definition) => definition.id !== chatPaneId));
</script>

{#if available.length > 0}
	<div class="fixed right-4 bottom-10 z-overlay flex items-center gap-1 rounded-full border border-line bg-elevated px-2 py-1 shadow-lg">
		<span class="text-faint"><SquaresFourIcon size={13} /></span>
		{#each available as definition (definition.id)}
			<button
				type="button"
				class="rounded-full px-2 py-0.5 text-2xs {panes.isOpen(definition.id)
					? 'bg-raised text-default'
					: 'text-dim hover:text-default'}"
				onclick={() => panes.toggle(definition.id)}
			>
				{definition.title}
			</button>
		{/each}
	</div>
{/if}
