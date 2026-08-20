<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Card, type IconComponent, type StatusTone } from '@neoworks-dev/ui';

	const {
		icon: Icon,
		title,
		tone = 'neutral',
		status,
		children,
		actions,
	}: {
		icon: IconComponent;
		title: string;
		tone?: StatusTone;
		/** Short state word shown next to the title (streaming, error, …). */
		status?: string;
		children: Snippet;
		actions?: Snippet;
	} = $props();

	const toneClass: Record<StatusTone, string> = {
		neutral: 'text-dim',
		green: 'text-green',
		red: 'text-red',
		amber: 'text-amber',
		blue: 'text-blue',
		violet: 'text-violet',
	};
</script>

<Card surface="raised" padding="none" class="overflow-hidden">
	<header class="flex items-center gap-2 border-b border-line-faint px-3 py-1.5">
		<span class={toneClass[tone]}><Icon size={14} /></span>
		<span class="text-2xs tracking-caps uppercase text-dim">{title}</span>
		{#if status}
			<span class="text-2xs {toneClass[tone]}">{status}</span>
		{/if}
		{#if actions}
			<span class="ml-auto flex items-center gap-2">{@render actions()}</span>
		{/if}
	</header>
	{@render children()}
</Card>
