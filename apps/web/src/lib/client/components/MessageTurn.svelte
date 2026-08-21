<script lang="ts">
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import type { BlockView, MessageView, SessionView } from '@nib-ui/protocol';
	import BlockHost from './BlockHost.svelte';
	import SlotHost from './SlotHost.svelte';

	const { message, session }: { message: MessageView; session: SessionView } = $props();

	let expanded = $state(false);

	const isUser = $derived(message.role === 'user');
	const steps = $derived(message.blocks.filter((block) => !isProse(block)));
	// A finished turn keeps its answer and folds the work that produced it.
	const collapsed = $derived(message.completed && !expanded && steps.length > 0);

	function isProse(block: BlockView): boolean {
		return block.kind === 'text';
	}
</script>

{#if isUser}
	<article class="flex flex-col gap-2 rounded-xl border border-line-faint bg-raised px-4 py-3">
		{#each message.blocks as block (block.id)}
			<BlockHost {block} {session} />
		{/each}
	</article>
{:else}
	<!-- The assistant turn is the page, not a card: blocks flow at the full column width. -->
	<article class="flex flex-col gap-3">
		{#if message.completed && steps.length > 0}
			<button
				type="button"
				class="flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 text-2xs text-dim hover:bg-hover hover:text-default"
				onclick={() => (expanded = !expanded)}
			>
				{#if collapsed}
					<CaretRightIcon size={12} />
					{steps.length}
					{steps.length === 1 ? 'step' : 'steps'}
				{:else}
					<CaretDownIcon size={12} />
					hide steps
				{/if}
			</button>
		{/if}

		{#each message.blocks as block (block.id)}
			{#if !collapsed || isProse(block)}
				<BlockHost {block} {session} />
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
