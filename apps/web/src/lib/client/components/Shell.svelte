<script lang="ts">
	import { clientContext } from '../context';
	import CommandPalette from './CommandPalette.svelte';
	import Composer from './Composer.svelte';
	import MessageList from './MessageList.svelte';
	import PermissionPrompt from './PermissionPrompt.svelte';
	import SessionHeader from './SessionHeader.svelte';
	import Sidebar from './Sidebar.svelte';
	import SlotHost from './SlotHost.svelte';

	const sessions = clientContext().require('sessions');
	const session = $derived(sessions.active);

	let feed = $state<HTMLDivElement>();

	$effect(() => {
		// Follow the tail while new events land; `lastSeq` ticks on every one.
		session?.lastSeq;
		feed?.scrollTo({ top: feed.scrollHeight });
	});
</script>

<div class="grid h-screen grid-cols-[300px_1fr] bg-canvas text-default">
	<Sidebar />

	<main class="flex min-h-0 flex-col">
		{#if session}
			<SessionHeader {session} />

			<div bind:this={feed} class="min-h-0 flex-1 overflow-y-auto">
				<MessageList {session} />
			</div>

			{#each session.pendingPermissions as request (request.requestId)}
				<PermissionPrompt {request} {session} />
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
