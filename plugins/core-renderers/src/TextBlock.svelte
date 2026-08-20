<script lang="ts">
	import type { RendererProps } from '@nib-ui/ui-contracts';
	import { renderMarkdown } from './markdown';

	const { block }: RendererProps = $props();
	const html = $derived(renderMarkdown(block.text));
</script>

<div class="text-base leading-relaxed text-default">
	{@html html}
	{#if !block.completed}
		<span class="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-muted align-text-bottom"></span>
	{/if}
</div>
