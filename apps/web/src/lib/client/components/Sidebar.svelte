<script lang="ts">
	import { Button, SectionHeader, Select, StatusBadge } from '@neoworks-dev/ui';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { clientContext } from '../context';
	import { statusTone } from '../status-tone';
	import DirectoryPicker from './DirectoryPicker.svelte';
	import SlotHost from './SlotHost.svelte';

	const sessions = clientContext().require('sessions');

	let cwd = $state('');
	let label = $state('');
	let harnessId = $state('');

	const harnessOptions = $derived(
		sessions.harnesses.map((harness) => ({ value: harness.id, label: harness.displayName })),
	);
	const selectedHarness = $derived(harnessId || (sessions.harnesses[0]?.id ?? ''));
	const trimmedCwd = $derived(cwd.trim().replace(/\/+$/, '') || cwd.trim());
	const canStart = $derived(selectedHarness.length > 0 && trimmedCwd.length > 0);

	async function createSession() {
		if (!canStart) return;
		await sessions.create({ harnessId: selectedHarness, cwd: trimmedCwd, label: label.trim() || undefined });
		label = '';
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
		<DirectoryPicker value={cwd} recent={sessions.recentDirectories} onChange={(value) => (cwd = value)} />
		<input
			bind:value={label}
			placeholder="Label (optional)"
			class="rounded-lg border border-line bg-input px-3 py-2 text-sm text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
		/>
		<Button full icon={PlusIcon} onclick={createSession} disabled={!canStart}>Start session</Button>
		{#if sessions.error}
			<p class="text-xs text-red">{sessions.error}</p>
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
		{#each sessions.summaries as summary (summary.id)}
			<button
				type="button"
				onclick={() => sessions.open(summary.id)}
				class="flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors duration-fast {summary.id ===
				sessions.activeId
					? 'bg-raised'
					: 'hover:bg-hover'}"
			>
				<span class="flex items-center gap-2">
					<span class="truncate text-sm text-default">{summary.title ?? summary.cwd}</span>
					<span class="ml-auto shrink-0">
						<StatusBadge tone={statusTone(summary.status)}>{summary.status}</StatusBadge>
					</span>
				</span>
				<span class="truncate font-mono text-2xs text-faint">{summary.harnessId} · {summary.cwd}</span>
			</button>
		{/each}
		{#if sessions.summaries.length === 0}
			<p class="px-2 py-3 text-xs text-dim">No sessions yet.</p>
		{/if}
	</div>

	<SlotHost slot="sidebar.nav" session={sessions.active} class="border-t border-line px-4 py-3" />
</aside>
