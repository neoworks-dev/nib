<script lang="ts">
	import { blockToolInput, blockToolOutput, findToolResultBlock } from '@nib-ui/protocol';
	import { FileIcon } from '@nib-ui/file-icons';
	import type { RendererProps } from '@nib-ui/ui-contracts';

	const { block, session }: RendererProps = $props();

	const input = $derived((blockToolInput(block) ?? {}) as Record<string, unknown>);
	const path = $derived(
		typeof input.file_path === 'string'
			? input.file_path
			: typeof input.notebook_path === 'string'
				? input.notebook_path
				: 'unknown file',
	);

	const result = $derived(findToolResultBlock(session, block.toolUseId));
	const output = $derived(result ? blockToolOutput(result) : undefined);
	const text = $derived(
		typeof output === 'string' ? output : output ? JSON.stringify(output, null, 2) : 'no output yet',
	);
</script>

<div class="overflow-hidden rounded-lg border border-line-faint bg-input text-xs">
	<header class="flex items-center gap-2 px-3 py-1.5">
		<FileIcon {path} size={14} />
		<span class="truncate font-mono text-2xs text-muted">{path}</span>
	</header>
	<pre
		class="max-h-72 overflow-auto border-t border-line-faint px-3 py-2 font-mono text-2xs whitespace-pre-wrap text-muted">{text}</pre>
</div>
