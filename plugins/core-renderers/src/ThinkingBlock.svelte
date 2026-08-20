<script lang="ts">
	import BrainIcon from 'phosphor-svelte/lib/BrainIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import type { RendererProps } from '@nib-ui/ui-contracts';

	const { block }: RendererProps = $props();

	let expanded = $state(false);
	const preview = $derived(block.text.trim().split('\n')[0] ?? '');
</script>

<div class="rounded-lg border border-dashed border-line-faint bg-canvas/40">
	<button
		type="button"
		class="flex w-full items-center gap-2 px-3 py-1.5 text-left"
		onclick={() => (expanded = !expanded)}
	>
		<span class="text-violet">
			{#if expanded}
				<CaretDownIcon size={12} />
			{:else}
				<CaretRightIcon size={12} />
			{/if}
		</span>
		<span class="text-violet"><BrainIcon size={14} /></span>
		<span class="text-2xs tracking-caps uppercase text-dim">Thinking</span>
		{#if !expanded}
			<span class="truncate text-xs text-faint italic">{preview}</span>
		{/if}
		{#if !block.completed}
			<span class="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-violet"></span>
		{/if}
	</button>
	{#if expanded}
		<pre
			class="max-h-80 overflow-auto px-3 pb-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">{block.text}</pre>
	{/if}
</div>
