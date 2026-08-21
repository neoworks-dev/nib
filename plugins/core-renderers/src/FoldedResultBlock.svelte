<script lang="ts">
	import { blockToolOutput, findToolUseBlock } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';

	const { block, session }: RendererProps = $props();

	// The call renders the content; only an orphan or an error is worth a row.
	const folded = $derived(findToolUseBlock(session, block.toolUseId) !== null);
	const failed = $derived(block.content?.kind === 'tool_result' && (block.content as { isError?: boolean }).isError);
	const output = $derived(blockToolOutput(block));
	const text = $derived(typeof output === 'string' ? output : JSON.stringify(output ?? ''));
</script>

{#if failed}
	<p class="rounded-lg border border-red bg-input px-3 py-2 font-mono text-xs whitespace-pre-wrap text-red">{text}</p>
{:else if !folded}
	<p class="px-1 font-mono text-2xs text-dim">{text.slice(0, 200)}</p>
{/if}
