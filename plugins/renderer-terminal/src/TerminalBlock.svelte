<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import PlayIcon from 'phosphor-svelte/lib/PlayIcon';
	import { blockToolInput, blockToolOutput, findToolResultBlock, findToolUseBlock } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';
	import { stripAnsi } from './ansi';

	const { block, session, detail = false }: RendererProps = $props();

	let expanded = $state(false);
	const open = $derived(detail || expanded);

	// The call owns the strip, so a result whose call is on screen renders nothing.
	const foldedIntoCall = $derived(block.kind === 'tool_result' && findToolUseBlock(session, block.toolUseId) !== null);
	const result = $derived(block.kind === 'tool_use' ? findToolResultBlock(session, block.toolUseId) : block);

	const input = $derived((blockToolInput(block) ?? {}) as Record<string, unknown>);
	const command = $derived(typeof input.command === 'string' ? input.command : '');
	const description = $derived(typeof input.description === 'string' ? input.description : '');

	const output = $derived(result ? blockToolOutput(result) : undefined);
	const text = $derived(stripAnsi(typeof output === 'string' ? output : output ? JSON.stringify(output, null, 2) : ''));
	const lines = $derived(text.length > 0 ? text.split('\n') : []);
	const failed = $derived(
		result?.content?.kind === 'tool_result' && (result.content as { isError?: boolean }).isError === true,
	);
	const phase = $derived(!block.completed ? 'writing' : !result ? 'running' : failed ? 'failed' : 'done');
	const phaseTone = $derived(
		phase === 'failed' ? 'text-red' : phase === 'done' ? 'text-green' : 'text-amber animate-pulse',
	);
</script>

{#if !foldedIntoCall}
	<div
		class="overflow-hidden border border-line-faint bg-input font-mono {detail
			? 'rounded-xl p-4 text-sm leading-relaxed'
			: 'rounded-lg text-xs'}"
	>
		{#if !detail}
			<button
				type="button"
				class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
				onclick={() => (expanded = !expanded)}
			>
				<span class="shrink-0 text-green"><PlayIcon size={12} weight="fill" /></span>
				<span class="shrink-0 text-2xs tracking-caps uppercase text-dim">Ran</span>
				<span class="truncate text-default">{command || '…'}</span>
				<span class="ml-auto shrink-0 text-2xs {phaseTone}">{phase}</span>
				<span class="shrink-0 text-faint">
					{#if expanded}
						<CaretDownIcon size={12} />
					{:else}
						<CaretRightIcon size={12} />
					{/if}
				</span>
			</button>
		{/if}

		{#if open}
			<div class={detail ? '' : 'border-t border-line-faint px-3 py-2'}>
				<div class="flex gap-2">
					<span class="shrink-0 select-none text-dim">$</span>
					<span class="whitespace-pre-wrap text-default">{command}</span>
				</div>
				{#if description}
					<p class="mt-1 text-xs text-dim">{description}</p>
				{/if}
			</div>
			<div
				class="overflow-auto {detail
					? 'mt-4 max-h-64'
					: 'max-h-96 border-t border-line-faint px-3 py-2'}"
			>
				{#each lines as line, index (index)}
					<div class="whitespace-pre-wrap {failed ? 'text-red' : 'text-dim'}">{line}</div>
				{/each}
				{#if lines.length === 0}
					<div class="text-dim">{result ? 'no output' : 'waiting for output…'}</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
