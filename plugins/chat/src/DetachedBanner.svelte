<script lang="ts">
	import type { SessionView } from '@nib-ui/protocol';
	import { kernelContext } from '@nib-ui/ui-contracts/svelte';

	const { session }: { session: SessionView } = $props();

	const sessions = kernelContext().require('sessions');

	const summary = $derived(sessions.summaries.find((entry) => entry.id === session.sessionId));
	// A resumable task reattaches itself on the next command, so being detached is
	// not news. Only a harness that cannot resume leaves a transcript you can read
	// and nothing more, and that is worth saying before someone types into it.
	const readOnly = $derived(summary !== undefined && !summary.live && !summary.resumable);
</script>

{#if readOnly}
	<p class="border-t border-line bg-surface px-3 py-2 text-xs text-dim">
		This task's harness process is gone, and {summary?.harnessId} cannot resume a session. The transcript is read-only.
	</p>
{/if}
