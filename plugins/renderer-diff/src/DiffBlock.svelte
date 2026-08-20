<script lang="ts">
	import { blockToolInput } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';
	import { diffLines } from './diff';

	const { block }: RendererProps = $props();

	const input = $derived((blockToolInput(block) ?? {}) as Record<string, unknown>);
	const filePath = $derived(typeof input.file_path === 'string' ? input.file_path : 'unknown file');
	const before = $derived(typeof input.old_string === 'string' ? input.old_string : '');
	const after = $derived(
		typeof input.new_string === 'string' ? input.new_string : typeof input.content === 'string' ? input.content : '',
	);
	const lines = $derived(diffLines(before, after));
	const added = $derived(lines.filter((line) => line.kind === 'added').length);
	const removed = $derived(lines.filter((line) => line.kind === 'removed').length);

	const markers = { added: '+', removed: '-', context: ' ' } as const;
	const styles = {
		added: 'bg-green-soft text-green',
		removed: 'bg-red-soft text-red',
		context: 'text-muted',
	} as const;
</script>

<div class="overflow-hidden rounded-md border border-line bg-input">
	<div class="flex items-center gap-2 border-b border-line-faint bg-raised px-3 py-1.5 text-xs">
		<span class="tracking-caps uppercase text-dim">{block.toolName}</span>
		<span class="truncate font-mono text-default">{filePath}</span>
		<span class="ml-auto font-mono text-green">+{added}</span>
		<span class="font-mono text-red">-{removed}</span>
	</div>
	{#if lines.length === 0}
		<p class="px-3 py-2 text-xs text-dim">Waiting for the tool input to finish streaming…</p>
	{:else}
		<div class="max-h-96 overflow-auto font-mono text-xs">
			{#each lines as line, index (index)}
				<div class="flex gap-2 px-3 py-px {styles[line.kind]}">
					<span class="select-none opacity-60">{markers[line.kind]}</span>
					<span class="whitespace-pre-wrap">{line.text}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
