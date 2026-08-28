<script lang="ts">
	import type { RendererProps } from '@nib-ui/ui-contracts';
	import { renderMarkdown } from './markdown';

	const { block }: RendererProps = $props();
	const html = $derived(renderMarkdown(block.text));
</script>

<div class="markdown text-base leading-relaxed text-default">
	{@html html}
	{#if !block.completed}
		<span class="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-muted align-text-bottom"></span>
	{/if}
</div>

<style>
	.markdown :global(> :first-child) {
		margin-top: 0;
	}

	.markdown :global(> :last-child) {
		margin-bottom: 0;
	}

	.markdown :global(p) {
		margin-block: 0.5rem;
	}

	.markdown :global(ul),
	.markdown :global(ol) {
		margin-block: 0.5rem;
		padding-inline-start: 1.35rem;
	}

	.markdown :global(ul) {
		list-style: disc;
	}

	.markdown :global(ol) {
		list-style: decimal;
	}

	.markdown :global(li) {
		margin-block: 0.125rem;
	}

	.markdown :global(li > ul),
	.markdown :global(li > ol),
	.markdown :global(li > p) {
		margin-block: 0.125rem;
	}

	.markdown :global(h1),
	.markdown :global(h2),
	.markdown :global(h3),
	.markdown :global(h4) {
		margin-top: 0.75rem;
		margin-bottom: 0.25rem;
		font-weight: 600;
	}

	.markdown :global(h1) {
		font-size: var(--text-lg);
	}

	.markdown :global(h2) {
		font-size: var(--text-md);
	}

	.markdown :global(strong) {
		font-weight: 600;
		color: var(--text);
	}

	.markdown :global(a) {
		color: var(--ctx-blue);
		text-decoration: underline;
	}

	.markdown :global(code) {
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		padding: 0.125rem 0.25rem;
		font-size: var(--text-xs);
	}

	.markdown :global(pre) {
		margin-block: 0.5rem;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface-input);
		padding: 0.75rem;
		font-size: var(--text-xs);
	}

	.markdown :global(pre code) {
		background: transparent;
		padding: 0;
	}

	.markdown :global(blockquote) {
		margin-block: 0.5rem;
		border-inline-start: 2px solid var(--border);
		padding-inline-start: 0.75rem;
		color: var(--text-muted);
	}

	.markdown :global(hr) {
		margin-block: 0.75rem;
		border-color: var(--border);
	}

	.markdown :global(table) {
		margin-block: 0.5rem;
		border-collapse: collapse;
	}

	.markdown :global(th),
	.markdown :global(td) {
		border: 1px solid var(--border);
		padding: 0.25rem 0.5rem;
		text-align: left;
	}

	.markdown :global(img) {
		max-width: 100%;
		border-radius: var(--radius-md);
	}
</style>
