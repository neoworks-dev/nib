<script lang="ts">
	import type { AnyAgentEvent } from '@nib-ui/protocol';
	import JsonNode from './JsonNode.svelte';

	const { event }: { event: AnyAgentEvent } = $props();

	const hasRaw = $derived(event.raw !== undefined);
</script>

<div class="grid min-h-0 grid-cols-2 divide-x divide-line-faint border-t border-line">
	<section class="flex min-h-0 flex-col">
		<h3 class="border-b border-line-faint px-3 py-1.5 text-2xs tracking-caps uppercase text-blue">
			normalized · data
		</h3>
		<div class="min-h-0 flex-1 overflow-auto px-2 py-2 font-mono text-2xs">
			<JsonNode label={null} value={event.data} />
		</div>
	</section>

	<section class="flex min-h-0 flex-col">
		<h3 class="border-b border-line-faint px-3 py-1.5 text-2xs tracking-caps uppercase text-amber">
			harness · raw
		</h3>
		<div class="min-h-0 flex-1 overflow-auto px-2 py-2 font-mono text-2xs">
			{#if hasRaw}
				<JsonNode label={null} value={event.raw} />
			{:else}
				<p class="px-1 text-dim">This event carries no native payload.</p>
			{/if}
		</div>
	</section>
</div>
