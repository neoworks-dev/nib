<script lang="ts">
	import { Button, ListRow, SectionHeader, Select, StatusBadge } from '@neoworks-dev/ui';
	import { clientContext } from '../context';
	import { statusTone } from '../status-tone';
	import SlotHost from './SlotHost.svelte';

	const sessions = clientContext().require('sessions');

	let cwd = $state('');
	let harnessId = $state('');

	const harnessOptions = $derived(
		sessions.harnesses.map((harness) => ({ value: harness.id, label: harness.displayName })),
	);
	const selectedHarness = $derived(harnessId || (sessions.harnesses[0]?.id ?? ''));

	async function createSession() {
		if (!selectedHarness || cwd.trim().length === 0) return;
		await sessions.create(selectedHarness, cwd.trim());
	}
</script>

<aside class="flex h-full min-h-0 flex-col border-r border-line bg-elevated">
	<div class="flex flex-col gap-3 border-b border-line px-4 py-4">
		<SectionHeader title="New session" />
		<Select
			value={selectedHarness}
			onChange={(value) => (harnessId = value as string)}
			options={harnessOptions}
			placeholder="Harness"
		/>
		<input
			bind:value={cwd}
			placeholder="Working directory"
			class="rounded-md border border-line bg-input px-3 py-2 text-sm text-default placeholder:text-faint"
		/>
		<Button full onclick={createSession} disabled={!selectedHarness || cwd.trim().length === 0}>Start</Button>
		{#if sessions.error}
			<p class="text-xs text-red">{sessions.error}</p>
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
		{#each sessions.summaries as summary (summary.id)}
			<ListRow
				title={summary.title ?? summary.cwd}
				subtitle={`${summary.harnessId} · ${summary.status}`}
				onclick={() => sessions.open(summary.id)}
			>
				{#snippet trailing()}
					<StatusBadge tone={statusTone(summary.status)}>{summary.status}</StatusBadge>
				{/snippet}
			</ListRow>
		{/each}
		{#if sessions.summaries.length === 0}
			<p class="px-2 py-3 text-xs text-dim">No sessions yet.</p>
		{/if}
	</div>

	<SlotHost slot="sidebar.nav" session={sessions.active} class="border-t border-line px-4 py-3" />
</aside>
