<script lang="ts">
	import { blockToolOutput } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';

	const { block }: RendererProps = $props();
	const output = $derived(blockToolOutput(block));
	const text = $derived(typeof output === 'string' ? output : JSON.stringify(output, null, 2));
	const isError = $derived(block.content?.kind === 'tool_result' && (block.content as { isError?: boolean }).isError);
</script>

<div class="rounded-md border {isError ? 'border-red' : 'border-line-faint'} bg-input">
	<div class="flex items-center gap-2 border-b border-line-faint px-3 py-1.5 text-xs">
		<span class="tracking-caps uppercase text-dim">Result</span>
		{#if isError}
			<span class="text-red">error</span>
		{/if}
	</div>
	<pre class="max-h-80 overflow-auto px-3 py-2 font-mono text-xs text-muted">{text ?? ''}</pre>
</div>
