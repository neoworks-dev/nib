<script lang="ts">
	import type { BlockView, MessageView, SessionView } from '@nib-ui/protocol';
	import { SlotHost } from '@nib-ui/ui-contracts/svelte';
	import { groupTurnBlocks } from './tool-groups';
	import BlockHost from './BlockHost.svelte';
	import ToolGroup from './ToolGroup.svelte';

	const { message, session }: { message: MessageView; session: SessionView } = $props();

	const isUser = $derived(message.role === 'user');
	// A user turn carrying only tool results is bookkeeping, not a prompt: its
	// blocks fold into the calls above them, so the card would frame nothing.
	const isPrompt = $derived(isUser && message.blocks.some(isProse));
	const items = $derived(groupTurnBlocks(message.blocks));

	function isProse(block: BlockView): boolean {
		return block.kind === 'text';
	}
</script>

{#if isPrompt}
	<article
		data-message={message.id}
		class="flex flex-col gap-2 rounded-xl border border-line-faint bg-raised px-4 py-3"
	>
		{#each message.blocks as block (block.id)}
			<BlockHost {block} {session} />
		{/each}
	</article>
{:else if isUser}
	{#each message.blocks as block (block.id)}
		<BlockHost {block} {session} />
	{/each}
{:else}
	<!-- The assistant turn is the page, not a card: blocks flow at the full column width. -->
	<article data-message={message.id} class="flex flex-col gap-3">
		{#each items as item (item.kind === 'group' ? item.group.id : item.block.id)}
			{#if item.kind === 'group'}
				<ToolGroup group={item.group} {session} />
			{:else}
				<BlockHost block={item.block} {session} />
			{/if}
		{/each}

		{#if !message.completed}
			<span class="flex items-center gap-2 text-2xs text-faint">
				<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue"></span>
				working
			</span>
		{:else if message.stopReason && message.stopReason !== 'end_turn'}
			<span class="text-2xs text-amber">{message.stopReason}</span>
		{/if}

		<SlotHost slot="message.footer" {session} {message} class="flex flex-col gap-2" />
		<SlotHost slot="message.actions" {session} {message} class="flex items-center gap-2" />
	</article>
{/if}
