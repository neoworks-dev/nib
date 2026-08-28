<script lang="ts">
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import CircleDashedIcon from 'phosphor-svelte/lib/CircleDashedIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import TargetIcon from 'phosphor-svelte/lib/TargetIcon';
	import { statusLabel, type PaneProps } from '@nib-ui/ui-contracts';
	import { readTodos, todoProgress } from './todos';

	const { session }: PaneProps = $props();

	const progress = $derived(todoProgress(session ? readTodos(session) : []));
	const done = $derived(progress.total > 0 && progress.completed === progress.total);
	const state = $derived(session ? (statusLabel(session.status) ?? 'Idle') : '');

	const rowIcon = { completed: CheckCircleIcon, in_progress: CircleNotchIcon, pending: CircleDashedIcon } as const;
	const rowTone = { completed: 'text-green', in_progress: 'text-blue', pending: 'text-faint' } as const;
</script>

{#if session}
	<div class="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
		<section class="rounded-xl border border-line-faint bg-surface p-3">
			<header class="flex items-center gap-2 text-2xs tracking-caps uppercase text-dim">
				Goal
				<span class="ml-auto {done ? 'text-green' : 'text-dim'}">{done ? 'Complete' : state}</span>
			</header>
			<p class="mt-2 flex items-start gap-2 text-sm text-default">
				<span class="shrink-0 pt-0.5 text-dim"><TargetIcon size={14} /></span>
				<span>{session.title ?? 'Untitled task'}</span>
			</p>
			{#if progress.total > 0}
				<p class="mt-1.5 pl-6 text-2xs tabular-nums text-faint">
					{progress.completed}/{progress.total} steps · ${session.usage.costUsd.toFixed(4)}
				</p>
			{/if}
		</section>

		{#if progress.total > 0}
			<section class="rounded-xl border border-line-faint bg-surface p-3">
				<h2 class="text-2xs tracking-caps uppercase text-dim">Progress</h2>
				<ul class="mt-2 flex flex-col gap-1.5">
					{#each progress.items as item, index (index)}
						{@const Icon = rowIcon[item.status]}
						<li class="flex items-start gap-2 text-xs">
							<span class="shrink-0 pt-0.5 {rowTone[item.status]}">
								<Icon size={14} weight={item.status === 'completed' ? 'fill' : 'regular'} />
							</span>
							<span class={item.status === 'completed' ? 'text-faint line-through' : 'text-muted'}>
								{item.status === 'in_progress' ? item.activeForm : item.content}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<p class="px-1 text-xs text-dim">No plan yet. It appears once the harness writes one.</p>
		{/if}
	</div>
{:else}
	<p class="p-3 text-xs text-dim">Open a task to see its plan.</p>
{/if}
