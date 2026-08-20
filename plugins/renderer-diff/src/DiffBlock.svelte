<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import FileCodeIcon from 'phosphor-svelte/lib/FileCodeIcon';
	import { blockToolInput, findToolResultBlock } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';
	import { diffLines } from './diff';

	const { block, session }: RendererProps = $props();

	let expanded = $state(false);

	const input = $derived((blockToolInput(block) ?? {}) as Record<string, unknown>);
	const filePath = $derived(typeof input.file_path === 'string' ? input.file_path : 'unknown file');
	const before = $derived(typeof input.old_string === 'string' ? input.old_string : '');
	const after = $derived(
		typeof input.new_string === 'string' ? input.new_string : typeof input.content === 'string' ? input.content : '',
	);
	const lines = $derived(diffLines(before, after));
	const added = $derived(lines.filter((line) => line.kind === 'added').length);
	const removed = $derived(lines.filter((line) => line.kind === 'removed').length);
	const verb = $derived(block.toolName === 'Write' ? 'Wrote' : 'Updated');

	const result = $derived(findToolResultBlock(session, block.toolUseId));
	const failed = $derived(
		result?.content?.kind === 'tool_result' && (result.content as { isError?: boolean }).isError === true,
	);
	const phase = $derived(!block.completed ? 'writing' : !result ? 'pending' : failed ? 'failed' : 'applied');
	const phaseTone = $derived(
		phase === 'failed' ? 'text-red' : phase === 'applied' ? 'text-green' : 'text-amber animate-pulse',
	);

	const markers = { added: '+', removed: '-', context: ' ' } as const;
	const styles = {
		added: 'bg-green-soft text-green',
		removed: 'bg-red-soft text-red',
		context: 'text-muted',
	} as const;
</script>

<div class="overflow-hidden rounded-lg border border-line-faint bg-input">
	<button
		type="button"
		class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
		onclick={() => (expanded = !expanded)}
	>
		<span class="shrink-0 text-blue"><FileCodeIcon size={14} /></span>
		<span class="shrink-0 text-2xs tracking-caps uppercase text-dim">{verb}</span>
		<span class="truncate font-mono text-xs text-default">{filePath}</span>
		<span class="ml-auto shrink-0 font-mono text-xs text-green">+{added}</span>
		<span class="shrink-0 font-mono text-xs text-red">-{removed}</span>
		<span class="shrink-0 text-2xs {phaseTone}">{phase}</span>
		<span class="shrink-0 text-faint">
			{#if expanded}
				<CaretDownIcon size={12} />
			{:else}
				<CaretRightIcon size={12} />
			{/if}
		</span>
	</button>

	{#if expanded}
		{#if lines.length === 0}
			<p class="border-t border-line-faint px-3 py-2 text-xs text-dim">Waiting for the tool input to finish streaming…</p>
		{:else}
			<div class="max-h-96 overflow-auto border-t border-line-faint font-mono text-xs">
				{#each lines as line, index (index)}
					<div class="flex gap-2 px-3 py-px {styles[line.kind]}">
						<span class="select-none opacity-60">{markers[line.kind]}</span>
						<span class="whitespace-pre-wrap">{line.text}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
