<script lang="ts">
	import BrainIcon from 'phosphor-svelte/lib/BrainIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
	import type { RendererProps } from '@nib-ui/ui-contracts';

	const { block }: RendererProps = $props();

	let expanded = $state(false);
	const preview = $derived(block.text.trim().split('\n')[0] ?? '');
</script>

<div class="flex min-w-0 flex-col gap-1">
	<button
		type="button"
		class="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs text-muted hover:bg-hover hover:text-default"
		onclick={() => (expanded = !expanded)}
	>
		<span class="shrink-0 {block.completed ? 'text-dim' : 'animate-pulse text-violet'}"><BrainIcon size={14} /></span>
		<span class="shrink-0">Thought</span>
		{#if !expanded && preview.length > 0}
			<span class="text-faint">·</span>
			<span class="truncate text-dim italic">{preview}</span>
		{/if}
		<span class="shrink-0 text-faint">
			{#if expanded}
				<CaretUpIcon size={12} />
			{:else}
				<CaretDownIcon size={12} />
			{/if}
		</span>
	</button>

	{#if expanded}
		<pre
			class="ml-2.5 max-h-80 overflow-auto border-l border-line pl-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-dim">{block.text}</pre>
	{/if}
</div>
