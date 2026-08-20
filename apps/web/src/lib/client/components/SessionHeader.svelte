<script lang="ts">
	import { StatusBadge } from '@neoworks-dev/ui';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import type { SessionView } from '@nib-ui/protocol';
	import { clientContext } from '../context';
	import { workspaceName } from '../session-groups';
	import { statusTone } from '../status-tone';
	import SlotHost from './SlotHost.svelte';

	const { session }: { session: SessionView } = $props();

	const sessions = clientContext().require('sessions');

	let renaming = $state(false);
	let draft = $state('');

	const workspace = $derived(session.cwd ? workspaceName(session.cwd) : (session.harnessId ?? 'workspace'));
	const task = $derived(session.title ?? 'Untitled task');

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

<header class="flex flex-wrap items-center gap-2 border-b border-line px-6 py-3">
	<nav class="flex min-w-0 items-center gap-2 text-sm" aria-label="Breadcrumb">
		<span class="truncate text-dim" title={session.cwd ?? ''}>{workspace}</span>
		<span class="text-faint">/</span>
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
				class="rounded-md border border-line bg-input px-2 py-0.5 text-sm text-default focus:border-line-strong focus:outline-none"
			/>
		{:else}
			<button type="button" class="group flex min-w-0 items-center gap-1.5 text-left" onclick={startRename}>
				<span class="truncate font-medium text-default">{task}</span>
				<span class="shrink-0 text-faint opacity-0 transition-opacity duration-fast group-hover:opacity-100">
					<PencilSimpleIcon size={13} />
				</span>
			</button>
		{/if}
	</nav>

	<StatusBadge tone={statusTone(session.status)}>{session.status}</StatusBadge>

	{#if session.statusDetail}
		<span class="truncate text-xs text-dim">{session.statusDetail}</span>
	{/if}

	<SlotHost slot="session.header" {session} class="ml-auto flex items-center gap-3" />
</header>
