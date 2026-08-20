<script lang="ts">
	import type { SessionView } from '@nib-ui/protocol';
	import BlockHost from './BlockHost.svelte';
	import SlotHost from './SlotHost.svelte';

	const { session }: { session: SessionView } = $props();
</script>

<div class="flex flex-col gap-6 px-6 py-5">
	{#each session.messages as message (message.id)}
		<article class="flex flex-col gap-2">
			<header class="flex items-center gap-2 text-xs tracking-caps uppercase text-dim">
				<span>{message.role}</span>
				{#if !message.completed}
					<span class="text-faint">·  in progress</span>
				{/if}
				<SlotHost slot="message.actions" {session} class="ml-auto flex items-center gap-2" />
			</header>
			<div class="flex flex-col gap-2 {message.role === 'user' ? 'border-l-2 border-line pl-3' : ''}">
				{#each message.blocks as block (block.id)}
					<BlockHost {block} {session} />
				{/each}
			</div>
		</article>
	{/each}

	{#if session.messages.length === 0}
		<p class="text-sm text-dim">No messages yet. Send a prompt to start the turn.</p>
	{/if}
</div>
