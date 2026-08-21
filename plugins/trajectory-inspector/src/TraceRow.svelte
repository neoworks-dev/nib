<script lang="ts">
	import type { TraceKind, TraceNode } from './trace';

	const { node, selected, onselect }: { node: TraceNode; selected: boolean; onselect: () => void } = $props();

	const badgeTone: Record<TraceKind, string> = {
		session: 'bg-raised text-dim',
		message: 'bg-raised text-blue',
		text: 'bg-raised text-faint',
		thinking: 'bg-raised text-violet',
		tool: 'bg-raised text-amber',
		permission: 'bg-raised text-red',
		state: 'bg-raised text-green',
		log: 'bg-raised text-dim',
		other: 'bg-raised text-faint',
	};

	const oneLine = $derived(collapse(node.detail));
	const resultLine = $derived(node.result ? collapse(node.result) : '');

	function collapse(text: string): string {
		return text.replace(/\s+/g, ' ').trim();
	}
</script>

<button
	type="button"
	onclick={onselect}
	class="flex w-full items-baseline gap-2 border-l-2 py-1 pr-2 text-left {selected
		? 'border-action bg-hover'
		: 'border-transparent hover:bg-hover'}"
	style="padding-left: {8 + node.depth * 18}px"
>
	<span class="w-20 shrink-0 rounded px-1.5 py-px text-center text-2xs tracking-caps {badgeTone[node.kind]}">
		{node.badge}
	</span>
	<span class="shrink-0 font-medium text-default">{node.title}</span>
	<span class="min-w-0 flex-1 truncate text-faint">{oneLine}</span>
	{#if resultLine}
		<span class="min-w-0 max-w-[35%] truncate text-dim">→ {resultLine}</span>
	{/if}
	{#if node.status === 'error'}
		<span class="shrink-0 text-2xs text-red">error</span>
	{:else if node.status === 'streaming'}
		<span class="shrink-0 animate-pulse text-2xs text-amber">…</span>
	{/if}
	<span class="w-12 shrink-0 text-right text-2xs tabular-nums text-faint">
		{node.durationMs === null ? '' : `${node.durationMs}ms`}
	</span>
</button>
