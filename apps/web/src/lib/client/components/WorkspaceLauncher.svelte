<script lang="ts">
	import { untrack } from 'svelte';
	import { Button, Select } from '@neoworks-dev/ui';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import { clientContext } from '../context';
	import DirectoryPicker from './DirectoryPicker.svelte';

	const { initialCwd = '', onclose }: { initialCwd?: string; onclose: () => void } = $props();

	const sessions = clientContext().require('sessions');

	// The prop only seeds the field; the user owns it from the first keystroke on.
	let cwd = $state(untrack(() => initialCwd));
	let label = $state('');
	let harnessId = $state('');
	let starting = $state(false);

	const harnessOptions = $derived(
		sessions.harnesses.map((harness) => ({ value: harness.id, label: harness.displayName })),
	);
	const selectedHarness = $derived(harnessId || (sessions.harnesses[0]?.id ?? ''));
	const trimmedCwd = $derived(cwd.trim().replace(/(.)\/+$/, '$1'));
	const canStart = $derived(selectedHarness.length > 0 && trimmedCwd.length > 0 && !starting);

	async function start() {
		if (!canStart) return;
		starting = true;
		await sessions.create({ harnessId: selectedHarness, cwd: trimmedCwd, label: label.trim() || undefined });
		starting = false;
		if (!sessions.error) onclose();
	}
</script>

<div class="flex flex-col gap-2 border-b border-line bg-surface px-3 py-3">
	{#if sessions.harnesses.length > 1}
		<Select
			value={selectedHarness}
			onChange={(value) => (harnessId = value as string)}
			options={harnessOptions}
			placeholder="Harness"
		/>
	{/if}

	<DirectoryPicker value={cwd} recent={sessions.recentDirectories} onChange={(value) => (cwd = value)} />

	<input
		bind:value={label}
		placeholder="Task name (optional)"
		onkeydown={(event) => {
			if (event.key === 'Enter') start();
		}}
		class="rounded-lg border border-line bg-input px-3 py-2 text-sm text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
	/>

	<div class="flex gap-2">
		<Button variant="primary" icon={ArrowRightIcon} disabled={!canStart} onclick={start}>
			{starting ? 'Starting…' : 'Start task'}
		</Button>
		<Button variant="ghost" onclick={onclose}>Cancel</Button>
	</div>

	{#if sessions.error}
		<p class="text-xs text-red">{sessions.error}</p>
	{/if}
</div>
