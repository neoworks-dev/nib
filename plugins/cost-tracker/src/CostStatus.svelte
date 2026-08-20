<script lang="ts">
	import type { SlotProps } from '@nib-ui/ui-contracts';

	const { session }: SlotProps = $props();

	const usage = $derived(session?.usage ?? null);
	const total = $derived(usage ? usage.inputTokens + usage.outputTokens : 0);
	const cost = $derived(usage ? usage.costUsd.toFixed(4) : '0.0000');
</script>

{#if usage}
	<span class="flex items-center gap-3 font-mono">
		<span title="input / output tokens">{usage.inputTokens} in · {usage.outputTokens} out</span>
		{#if usage.cacheReadTokens > 0}
			<span title="cache reads">{usage.cacheReadTokens} cached</span>
		{/if}
		<span class="text-muted">{total} tokens</span>
		<span class="text-default">${cost}</span>
	</span>
{/if}
