<script lang="ts">
	import { StatusBadge } from '@neoworks-dev/ui';
	import { clientContext } from '../context';
	import { statusTone } from '../status-tone';
	import CommandPalette from './CommandPalette.svelte';
	import Composer from './Composer.svelte';
	import MessageList from './MessageList.svelte';
	import PermissionPrompt from './PermissionPrompt.svelte';
	import Sidebar from './Sidebar.svelte';
	import SlotHost from './SlotHost.svelte';

	const sessions = clientContext().require('sessions');
	const session = $derived(sessions.active);
</script>

<div class="grid h-screen grid-cols-[280px_1fr] bg-canvas text-default">
	<Sidebar />

	<main class="flex min-h-0 flex-col">
		{#if session}
			<header class="flex items-center gap-3 border-b border-line px-6 py-3">
				<h1 class="text-md font-semibold">{session.title ?? session.cwd ?? 'Session'}</h1>
				<StatusBadge tone={statusTone(session.status)}>{session.status}</StatusBadge>
				{#if session.statusDetail}
					<span class="text-xs text-dim">{session.statusDetail}</span>
				{/if}
				<SlotHost slot="session.header" {session} class="ml-auto flex items-center gap-3" />
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto">
				<MessageList {session} />
			</div>

			{#each session.pendingPermissions as request (request.requestId)}
				<PermissionPrompt {request} />
			{/each}

			<Composer {session} />
		{:else}
			<div class="flex flex-1 items-center justify-center text-sm text-dim">
				Pick a session or start a new one. Press ⌘/Ctrl+K for commands.
			</div>
		{/if}

		<SlotHost
			slot="statusbar"
			{session}
			class="flex items-center gap-4 border-t border-line bg-elevated px-6 py-1.5 text-xs text-dim"
		/>
	</main>
</div>

<CommandPalette />
