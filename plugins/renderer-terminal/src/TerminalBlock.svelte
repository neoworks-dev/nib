<script lang="ts">
	import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindowIcon';
	import { blockToolInput, blockToolOutput } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';
	import { stripAnsi } from './ansi';

	const collapsedLines = 30;

	const { block }: RendererProps = $props();
	let expanded = $state(false);

	const input = $derived((blockToolInput(block) ?? {}) as Record<string, unknown>);
	const command = $derived(typeof input.command === 'string' ? input.command : '');
	const description = $derived(typeof input.description === 'string' ? input.description : '');
	const output = $derived(blockToolOutput(block));
	const text = $derived(stripAnsi(typeof output === 'string' ? output : output ? JSON.stringify(output, null, 2) : ''));
	const lines = $derived(text.length > 0 ? text.split('\n') : []);
	const visible = $derived(expanded ? lines : lines.slice(0, collapsedLines));
</script>

<div class="overflow-hidden rounded-lg border border-line-faint bg-input font-mono text-xs">
	<div class="flex items-center gap-2 border-b border-line-faint bg-raised px-3 py-1.5">
		<span class="text-green"><TerminalWindowIcon size={14} /></span>
		<span class="text-2xs tracking-caps uppercase text-dim">
			{block.kind === 'tool_use' ? 'bash' : 'bash output'}
		</span>
		{#if !block.completed}
			<span class="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-amber"></span>
		{/if}
	</div>
	{#if block.kind === 'tool_use'}
		<div class="flex gap-2 px-3 py-2 text-green">
			<span class="select-none text-dim">$</span>
			<span class="whitespace-pre-wrap text-default">{command}</span>
		</div>
		{#if description}
			<p class="border-t border-line-faint px-3 py-1 text-2xs text-dim">{description}</p>
		{/if}
	{:else}
		<div class="max-h-96 overflow-auto px-3 py-2">
			{#each visible as line, index (index)}
				<div class="whitespace-pre-wrap text-muted">{line}</div>
			{/each}
			{#if lines.length === 0}
				<div class="text-dim">no output</div>
			{/if}
		</div>
		{#if lines.length > collapsedLines}
			<button
				type="button"
				class="w-full border-t border-line-faint px-3 py-1 text-left text-2xs text-dim hover:text-default"
				onclick={() => (expanded = !expanded)}
			>
				{expanded ? 'collapse' : `show ${lines.length - collapsedLines} more lines`}
			</button>
		{/if}
	{/if}
</div>
