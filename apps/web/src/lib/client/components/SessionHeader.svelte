<script lang="ts">
	import { StatusBadge, Tooltip } from '@neoworks-dev/ui';
	import CpuIcon from 'phosphor-svelte/lib/CpuIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon';
	import type { SessionView } from '@nib-ui/protocol';
	import { clientContext } from '../context';
	import { statusTone } from '../status-tone';
	import SlotHost from './SlotHost.svelte';

	const { session }: { session: SessionView } = $props();

	const sessions = clientContext().require('sessions');

	let renaming = $state(false);
	let draft = $state('');

	const heading = $derived(session.title ?? session.cwd ?? 'Session');
	const activeModel = $derived(session.models.find((model) => model.id === session.model));

	function startRename() {
		draft = session.title ?? '';
		renaming = true;
	}

	async function commitRename() {
		renaming = false;
		const label = draft.trim();
		if (label.length > 0 && label !== session.title) await sessions.setLabel(label);
	}
</script>

<header class="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
	{#if renaming}
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:value={draft}
			autofocus
			onblur={commitRename}
			onkeydown={(event) => {
				if (event.key === 'Enter') commitRename();
				if (event.key === 'Escape') renaming = false;
			}}
			class="rounded-md border border-line bg-input px-2 py-1 text-md text-default focus:border-line-strong focus:outline-none"
		/>
	{:else}
		<button type="button" class="group flex items-center gap-2 text-left" onclick={startRename}>
			<h1 class="truncate text-md font-semibold">{heading}</h1>
			<span class="text-faint opacity-0 transition-opacity duration-fast group-hover:opacity-100">
				<PencilSimpleIcon size={14} />
			</span>
		</button>
	{/if}

	<StatusBadge tone={statusTone(session.status)}>{session.status}</StatusBadge>

	{#if session.harnessId}
		<span class="font-mono text-2xs tracking-caps uppercase text-faint">{session.harnessId}</span>
	{/if}

	{#if session.permissionMode}
		<Tooltip text="Permission mode">
			<span class="flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-2xs text-muted">
				<ShieldCheckIcon size={12} />
				{session.permissionMode}
			</span>
		</Tooltip>
	{/if}

	{#if session.model}
		<Tooltip text="Model">
			<span class="flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-2xs text-muted">
				<CpuIcon size={12} />
				{activeModel?.displayName ?? session.model}
			</span>
		</Tooltip>
	{/if}

	{#if session.statusDetail}
		<span class="truncate text-xs text-dim">{session.statusDetail}</span>
	{/if}

	<SlotHost slot="session.header" {session} class="ml-auto flex items-center gap-3" />
</header>
