<script lang="ts">
	import type { RendererProps } from '@nib-ui/ui-contracts';

	const { block }: RendererProps = $props();
	let expanded = $state(false);
	const preview = $derived(block.text.trim().split('\n')[0] ?? '');
</script>

<div class="rounded-md border border-line-faint bg-raised/50 px-3 py-2">
	<button
		type="button"
		class="flex w-full items-center gap-2 text-left text-xs text-dim"
		onclick={() => (expanded = !expanded)}
	>
		<span class="font-mono">{expanded ? '▾' : '▸'}</span>
		<span class="tracking-caps uppercase">Thinking</span>
		{#if !expanded}
			<span class="truncate text-faint">{preview}</span>
		{/if}
	</button>
	{#if expanded}
		<pre class="mt-2 whitespace-pre-wrap font-mono text-xs text-muted">{block.text}</pre>
	{/if}
</div>
