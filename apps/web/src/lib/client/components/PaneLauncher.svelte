<script lang="ts">
	import { kernelContext } from '@nib-ui/ui-contracts/svelte';
	import { rootPaneId, type ReactivePaneRegistry } from '../registries/panes.svelte';

	const panes = kernelContext().require('panes') as ReactivePaneRegistry;

	const available = $derived(panes.list().filter((definition) => definition.id !== rootPaneId));
</script>

<div class="flex items-center gap-0.5">
	{#each available as definition (definition.id)}
		{@const Icon = definition.icon}
		<button
			type="button"
			title={definition.title}
			aria-label="{panes.isOpen(definition.id) ? 'Close' : 'Open'} the {definition.title} pane"
			aria-pressed={panes.isOpen(definition.id)}
			class="rounded-md p-1.5 {panes.isOpen(definition.id)
				? 'bg-raised text-default'
				: 'text-faint hover:bg-hover hover:text-default'}"
			onclick={() => panes.toggle(definition.id)}
		>
			{#if Icon}
				<Icon size={15} />
			{:else}
				<span class="text-2xs">{definition.title}</span>
			{/if}
		</button>
	{/each}
</div>
