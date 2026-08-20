<script lang="ts">
	import type { RendererProps } from '@nib-ui/ui-contracts';

	const { block }: RendererProps = $props();
	const content = $derived(
		block.content?.kind === 'image' ? (block.content as { mediaType: string; data?: string; url?: string }) : null,
	);
	const source = $derived(content?.url ?? (content?.data ? `data:${content.mediaType};base64,${content.data}` : null));
</script>

{#if source}
	<img class="max-h-96 rounded-md border border-line" src={source} alt="Attachment from the session" />
{:else}
	<div class="rounded-md border border-line bg-raised px-3 py-2 text-xs text-dim">image block without data</div>
{/if}
