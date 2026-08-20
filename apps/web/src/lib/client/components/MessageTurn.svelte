<script lang="ts">
	import { IconCircle } from '@neoworks-dev/ui';
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import UserCircleIcon from 'phosphor-svelte/lib/UserCircleIcon';
	import type { MessageView, SessionView } from '@nib-ui/protocol';
	import BlockHost from './BlockHost.svelte';
	import SlotHost from './SlotHost.svelte';

	const { message, session }: { message: MessageView; session: SessionView } = $props();

	const isUser = $derived(message.role === 'user');
</script>

<article class="flex gap-3">
	<div class="shrink-0 pt-0.5">
		<IconCircle icon={isUser ? UserCircleIcon : RobotIcon} tone={isUser ? 'neutral' : 'violet'} size="sm" />
	</div>

	<div
		class="min-w-0 flex-1 rounded-xl border px-4 py-3 {isUser
			? 'border-line-faint bg-raised'
			: 'border-line bg-surface'}"
	>
		<header class="mb-2 flex items-center gap-2 text-2xs tracking-caps uppercase">
			<span class={isUser ? 'text-muted' : 'text-violet'}>{isUser ? 'You' : 'Assistant'}</span>
			{#if !message.completed}
				<span class="flex items-center gap-1 text-faint">
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue"></span>
					streaming
				</span>
			{:else if message.stopReason && message.stopReason !== 'end_turn'}
				<span class="text-amber">{message.stopReason}</span>
			{/if}
			<SlotHost slot="message.actions" {session} class="ml-auto flex items-center gap-2" />
		</header>

		<div class="flex flex-col gap-3">
			{#each message.blocks as block (block.id)}
				<BlockHost {block} {session} />
			{/each}
			{#if message.blocks.length === 0}
				<p class="text-xs text-faint">No content in this turn.</p>
			{/if}
		</div>
	</div>
</article>
