<script lang="ts">
	import type { BlockView, SessionView } from '@nib-ui/protocol';
	import { kernelContext } from '@nib-ui/ui-contracts/svelte';

	const {
		block,
		session,
		detail = false,
	}: { block: BlockView; session: SessionView; detail?: boolean } = $props();

	const renderers = kernelContext().require('renderers');
	const Renderer = $derived(renderers.resolve(block));
</script>

{#if Renderer}
	<Renderer {block} {session} {detail} />
{:else}
	<pre class="rounded-md border border-line bg-raised px-3 py-2 font-mono text-xs">{JSON.stringify(block, null, 2)}</pre>
{/if}
