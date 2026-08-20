<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import type { SessionView } from '@nib-ui/protocol';
	import { clientContext } from '../context';
	import SlotHost from './SlotHost.svelte';

	const { session }: { session: SessionView } = $props();

	const sessions = clientContext().require('sessions');
	let draft = $state('');

	const busy = $derived(session.status === 'working');
	const canInterrupt = $derived(session.capabilities?.interrupt === true);

	async function submit() {
		const text = draft.trim();
		if (text.length === 0) return;
		draft = '';
		await sessions.send(text);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void submit();
	}
</script>

<div class="border-t border-line bg-elevated px-6 py-4">
	<div class="flex items-end gap-3">
		<textarea
			bind:value={draft}
			onkeydown={onKeydown}
			rows="2"
			placeholder="Send a message — Enter to send, Shift+Enter for a newline"
			class="min-h-16 flex-1 resize-y rounded-md border border-line bg-input px-3 py-2 text-base text-default placeholder:text-faint"
		></textarea>
		<div class="flex flex-col gap-2">
			<Button onclick={submit} disabled={draft.trim().length === 0}>Send</Button>
			{#if canInterrupt && busy}
				<Button variant="danger" onclick={() => sessions.interrupt()}>Interrupt</Button>
			{/if}
		</div>
		<SlotHost slot="composer.actions" {session} class="flex flex-col gap-2" />
	</div>
</div>
