<script lang="ts">
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import type { RendererProps } from '@nib-ui/ui-contracts';
	import { parseTodos, todoProgress } from './todos';

	const { block }: RendererProps = $props();

	const progress = $derived(todoProgress(parseTodos(block)));
	const label = $derived(
		progress.total === 0
			? 'Writing the plan…'
			: progress.current
				? progress.current.activeForm
				: `${progress.completed}/${progress.total} steps done`,
	);
</script>

<p class="flex items-center gap-2 rounded-lg border border-line-faint bg-input px-3 py-1.5 text-xs">
	<span class="shrink-0 text-dim"><ListChecksIcon size={14} /></span>
	<span class="truncate text-muted">{label}</span>
	{#if progress.total > 0}
		<span class="ml-auto shrink-0 text-2xs tabular-nums text-faint">{progress.completed}/{progress.total}</span>
	{/if}
</p>
