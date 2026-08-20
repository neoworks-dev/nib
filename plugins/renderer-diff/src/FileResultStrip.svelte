<script lang="ts">
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import { blockToolOutput, findToolUseBlock } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';

	const { block, session }: RendererProps = $props();

	// The diff card already reports success; only an orphaned or failed result needs a line.
	const folded = $derived(findToolUseBlock(session, block.toolUseId) !== null);
	const failed = $derived(block.content?.kind === 'tool_result' && (block.content as { isError?: boolean }).isError);
	const output = $derived(blockToolOutput(block));
	const text = $derived(typeof output === 'string' ? output : JSON.stringify(output ?? ''));
</script>

{#if failed}
	<div class="flex items-start gap-2 rounded-lg border border-red bg-input px-3 py-2 font-mono text-xs text-red">
		<span class="shrink-0 pt-0.5"><WarningIcon size={14} /></span>
		<span class="whitespace-pre-wrap">{text}</span>
	</div>
{:else if !folded}
	<p class="px-1 font-mono text-2xs text-dim">{text}</p>
{/if}
