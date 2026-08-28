<script lang="ts">
	import type { MessageView, SessionView } from '@nib-ui/protocol';
	import type { SlotName } from '../index';
	import { kernelContext } from './context';

	const {
		slot,
		session,
		message,
		class: className = '',
	}: { slot: SlotName; session: SessionView | null; message?: MessageView; class?: string } = $props();

	const slots = kernelContext().require('slots');
	const entries = $derived(slots.entries(slot, session));
</script>

{#if entries.length > 0}
	<div class={className}>
		{#each entries as entry, index (index)}
			{@const Contribution = entry.component}
			<Contribution {session} {message} />
		{/each}
	</div>
{/if}
