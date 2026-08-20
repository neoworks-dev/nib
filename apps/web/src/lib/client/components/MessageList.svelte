<script lang="ts">
	import type { SessionView } from '@nib-ui/protocol';
	import MessageTurn from './MessageTurn.svelte';

	const { session }: { session: SessionView } = $props();
</script>

<div class="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
	{#each session.messages as message (message.id)}
		<MessageTurn {message} {session} />
	{/each}

	{#if session.messages.length === 0}
		<p class="text-sm text-dim">No messages yet. Send a prompt to start the turn.</p>
	{/if}
</div>
