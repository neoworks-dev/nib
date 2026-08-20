<script lang="ts">
	import type { BlockView, SessionView } from '@nib-ui/protocol';
	import { clientContext } from '../context';

	const { block, session }: { block: BlockView; session: SessionView } = $props();

	const renderers = clientContext().require('renderers');
	const Renderer = $derived(renderers.resolve(block));
</script>

{#if Renderer}
	<Renderer {block} {session} />
{:else}
	<pre class="rounded-md border border-line bg-raised px-3 py-2 font-mono text-xs">{JSON.stringify(block, null, 2)}</pre>
{/if}
