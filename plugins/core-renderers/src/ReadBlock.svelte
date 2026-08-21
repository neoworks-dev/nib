<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { blockToolOutput, findToolResultBlock } from '@nib-ui/protocol';
	import { FileIcon } from '@nib-ui/file-icons';
	import type { RendererProps } from '@nib-ui/ui-contracts';
	import { readRun } from './read-group';

	const { block, session }: RendererProps = $props();

	let expanded = $state(false);

	const run = $derived(readRun(session, block));
	const label = $derived(
		run === null || run.length === 0
			? ''
			: run.length === 1
				? `Read ${basename(run[0]!.path)}`
				: `Read ${run.length} files`,
	);

	function basename(path: string): string {
		return path.slice(path.lastIndexOf('/') + 1);
	}

	function contents(blockId: string): string {
		const blocks = session.messages.find((message) => message.id === block.messageId)?.blocks ?? [];
		const call = blocks.find((candidate) => candidate.id === blockId);
		const result = call ? findToolResultBlock(session, call.toolUseId) : null;
		const output = result ? blockToolOutput(result) : undefined;
		return typeof output === 'string' ? output : output ? JSON.stringify(output, null, 2) : 'no output yet';
	}
</script>

{#if run && run.length > 0}
	<div class="overflow-hidden rounded-lg border border-line-faint bg-input text-xs">
		<button
			type="button"
			class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
			onclick={() => (expanded = !expanded)}
		>
			<FileIcon path={run[0]!.path} size={14} />
			<span class="truncate text-muted">{label}</span>
			<span class="ml-auto shrink-0 text-faint">
				{#if expanded}
					<CaretDownIcon size={12} />
				{:else}
					<CaretRightIcon size={12} />
				{/if}
			</span>
		</button>

		{#if expanded}
			<ul class="border-t border-line-faint">
				{#each run as entry (entry.blockId)}
					<li class="flex flex-col gap-1 border-b border-line-faint px-3 py-2 last:border-b-0">
						<span class="flex items-center gap-2">
							<FileIcon path={entry.path} size={14} />
							<span class="truncate font-mono text-2xs text-default">{entry.path}</span>
						</span>
						<pre
							class="max-h-64 overflow-auto rounded-md bg-raised p-2 font-mono text-2xs whitespace-pre-wrap text-muted">{contents(
								entry.blockId,
							)}</pre>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
