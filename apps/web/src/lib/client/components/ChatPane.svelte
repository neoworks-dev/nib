<script lang="ts">
	import type { PaneProps } from '@nib-ui/ui-contracts';
	import Composer from './Composer.svelte';
	import MessageList from './MessageList.svelte';
	import PermissionPrompt from './PermissionPrompt.svelte';

	const { session }: PaneProps = $props();

	let feed = $state<HTMLDivElement>();

	$effect(() => {
		// Follow the tail while new events land; `lastSeq` ticks on every one.
		session?.lastSeq;
		feed?.scrollTo({ top: feed.scrollHeight });
	});
</script>

{#if session}
	<div class="flex h-full min-h-0 flex-col">
		<div bind:this={feed} class="min-h-0 flex-1 overflow-y-auto">
			<MessageList {session} />
		</div>

		{#each session.pendingPermissions as request (request.requestId)}
			<PermissionPrompt {request} {session} />
		{/each}

		<Composer {session} />
	</div>
{:else}
	<div class="flex h-full items-center justify-center text-sm text-dim">
		Pick a task or start a new one. Press ⌘/Ctrl+K for commands.
	</div>
{/if}
