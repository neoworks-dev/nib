<script lang="ts">
	import type { SessionView } from '@nib-ui/protocol';
	import type { SlotName } from '@nib-ui/ui-contracts';
	import { clientContext } from '../context';

	const { slot, session, class: className = '' }: { slot: SlotName; session: SessionView | null; class?: string } =
		$props();

	const slots = clientContext().require('slots');
	const entries = $derived(slots.entries(slot, session));
</script>

<div class={className}>
	{#each entries as entry, index (index)}
		{@const Contribution = entry.component}
		<Contribution {session} />
	{/each}
</div>
