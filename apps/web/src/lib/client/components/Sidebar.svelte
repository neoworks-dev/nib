<script lang="ts">
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { clientContext } from '../context';
	import { groupSessionsByWorkspace } from '../session-groups';
	import SessionCard from './SessionCard.svelte';
	import SlotHost from './SlotHost.svelte';
	import WorkspaceLauncher from './WorkspaceLauncher.svelte';

	const sessions = clientContext().require('sessions');

	let launcher = $state<{ cwd: string } | null>(null);
	let now = $state(Date.now());

	const groups = $derived(groupSessionsByWorkspace(sessions.summaries));
	const activeSummary = $derived(sessions.summaries.find((summary) => summary.id === sessions.activeId));

	$effect(() => {
		// Card ages are relative, so they need a clock of their own.
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});
</script>

<aside class="flex h-full min-h-0 flex-col border-r border-line bg-elevated">
	<div class="flex items-center gap-1 border-b border-line px-3 py-2.5">
		<span class="text-sm font-semibold text-default">Tasks</span>
		<button
			type="button"
			class="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-dim hover:bg-hover hover:text-default"
			onclick={() => (launcher = { cwd: '' })}
		>
			<FolderOpenIcon size={14} />
			Open workspace
		</button>
		<button
			type="button"
			class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-dim hover:bg-hover hover:text-default"
			onclick={() => (launcher = { cwd: activeSummary?.cwd ?? sessions.recentDirectories[0] ?? '' })}
		>
			<PlusIcon size={14} />
			New task
		</button>
	</div>

	{#if launcher}
		{#key launcher.cwd}
			<WorkspaceLauncher initialCwd={launcher.cwd} onclose={() => (launcher = null)} />
		{/key}
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
		{#each groups as group (group.path)}
			<section class="mb-3">
				<h2 class="flex items-baseline gap-2 px-2.5 py-1">
					<span class="truncate text-2xs tracking-caps uppercase text-dim">{group.name}</span>
					<span class="ml-auto text-2xs tabular-nums text-faint">{group.sessions.length}</span>
				</h2>
				{#each group.sessions as summary (summary.id)}
					<SessionCard
						{summary}
						{now}
						active={summary.id === sessions.activeId}
						onopen={() => sessions.open(summary.id)}
					/>
				{/each}
			</section>
		{/each}

		{#if groups.length === 0}
			<p class="px-2.5 py-3 text-xs text-dim">No tasks yet. Open a workspace to start one.</p>
		{/if}
	</div>

	<SlotHost slot="sidebar.nav" session={sessions.active} class="border-t border-line px-4 py-3" />
</aside>
