<script lang="ts">
	import type { SessionSummary } from '@nib-ui/ui-contracts';
	import { formatRelativeTime } from '../relative-time';
	import { statusTone } from '../status-tone';

	const {
		summary,
		active,
		now,
		onopen,
	}: { summary: SessionSummary; active: boolean; now: number; onopen: () => void } = $props();

	const toneDot: Record<string, string> = {
		green: 'bg-green',
		amber: 'bg-amber',
		red: 'bg-red',
		blue: 'bg-blue',
		violet: 'bg-violet',
		neutral: 'bg-faint',
	};

	const dot = $derived(toneDot[statusTone(summary.status)] ?? 'bg-faint');
	const live = $derived(summary.status === 'working' || summary.status === 'awaiting-permission');
</script>

<button
	type="button"
	onclick={onopen}
	class="flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors duration-fast {active
		? 'bg-raised'
		: 'hover:bg-hover'}"
>
	<span class="flex w-full items-center gap-2">
		<span class="h-1.5 w-1.5 shrink-0 rounded-full {dot} {live ? 'animate-pulse' : ''}"></span>
		<span class="truncate text-sm {active ? 'text-default' : 'text-muted'}">{summary.title ?? 'Untitled task'}</span>
		<span class="ml-auto shrink-0 text-2xs tabular-nums text-faint">{formatRelativeTime(summary.updatedAt, now)}</span>
	</span>
	<span class="flex items-center gap-1.5 pl-3.5">
		<span class="rounded-full bg-raised px-1.5 py-px text-2xs text-faint">{summary.harnessId}</span>
		{#if summary.model}
			<span class="truncate rounded-full bg-raised px-1.5 py-px text-2xs text-faint">{summary.model}</span>
		{/if}
	</span>
</button>
