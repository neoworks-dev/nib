<script lang="ts">
	import { blockToolInput } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';

	const { block }: RendererProps = $props();
	const input = $derived(blockToolInput(block));
	const serialized = $derived(typeof input === 'string' ? input : JSON.stringify(input, null, 2));
</script>

<div class="rounded-md border border-line bg-raised">
	<div class="flex items-center gap-2 border-b border-line-faint px-3 py-1.5 text-xs">
		<span class="tracking-caps uppercase text-dim">Tool</span>
		<span class="font-mono text-default">{block.toolName ?? 'unknown'}</span>
		{#if !block.completed}
			<span class="text-faint">streaming…</span>
		{/if}
	</div>
	<pre class="overflow-x-auto px-3 py-2 font-mono text-xs text-muted">{serialized ?? ''}</pre>
</div>
