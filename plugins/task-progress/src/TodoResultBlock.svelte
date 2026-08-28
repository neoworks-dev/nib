<script lang="ts">
	import { blockToolOutput } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';

	const { block }: RendererProps = $props();

	// The plan line already reports success; only a failure is worth a row.
	const failed = $derived(block.content?.kind === 'tool_result' && (block.content as { isError?: boolean }).isError);
	const output = $derived(blockToolOutput(block));
	const text = $derived(typeof output === 'string' ? output : JSON.stringify(output ?? ''));
</script>

{#if failed}
	<p class="rounded-lg border border-red bg-input px-3 py-2 font-mono text-xs whitespace-pre-wrap text-red">{text}</p>
{/if}
