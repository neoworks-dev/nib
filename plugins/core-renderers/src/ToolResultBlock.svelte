<script lang="ts">
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import { blockToolOutput } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';
	import BlockShell from './BlockShell.svelte';

	const { block }: RendererProps = $props();

	const output = $derived(blockToolOutput(block));
	const text = $derived(typeof output === 'string' ? output : JSON.stringify(output, null, 2));
	const isError = $derived(block.content?.kind === 'tool_result' && (block.content as { isError?: boolean }).isError);
	const lineCount = $derived((text ?? '').split('\n').length);

	let expanded = $state(false);
</script>

<BlockShell
	icon={isError ? WarningIcon : CheckCircleIcon}
	title={block.toolName ? `${block.toolName} result` : 'result'}
	tone={isError ? 'red' : 'green'}
	status={isError ? 'error' : undefined}
>
	{#snippet actions()}
		{#if lineCount > 12}
			<button type="button" class="text-2xs text-dim hover:text-default" onclick={() => (expanded = !expanded)}>
				{expanded ? 'collapse' : `${lineCount} lines`}
			</button>
		{/if}
	{/snippet}
	<pre
		class="overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap {expanded
			? ''
			: 'max-h-60'} {isError ? 'text-red' : 'text-muted'}">{text ?? ''}</pre>
</BlockShell>
