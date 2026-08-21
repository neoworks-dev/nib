<script lang="ts">
	import { FileIcon } from '@nib-ui/file-icons';
	import type { SlotProps } from '@nib-ui/ui-contracts';
	import { summarizeChanges } from './changed-files';
	import { diffState } from './state.svelte';

	const { session, message }: SlotProps = $props();

	const summary = $derived(message ? summarizeChanges(message) : null);

	function open(path: string) {
		if (session) void diffState.viewer?.open(session.sessionId, path);
	}
</script>

{#if summary && summary.files.length > 0}
	<section class="overflow-hidden rounded-xl border border-line-faint bg-surface">
		<header class="flex items-center gap-2 border-b border-line-faint px-3 py-2 text-xs">
			<span class="text-muted">
				{summary.files.length}
				{summary.files.length === 1 ? 'file changed' : 'files changed'}
			</span>
			<span class="ml-auto font-mono text-green">+{summary.added}</span>
			<span class="font-mono text-red">-{summary.removed}</span>
		</header>
		<ul>
			{#each summary.files as file (file.path)}
				<li class="flex items-center gap-2 px-3 py-1.5 text-xs">
					<button type="button" class="flex min-w-0 items-center gap-2 text-left" onclick={() => open(file.path)}>
						<FileIcon path={file.path} size={14} />
						<span class="truncate font-mono text-default hover:underline">{file.path}</span>
					</button>
					<span class="ml-auto shrink-0 font-mono text-green">+{file.added}</span>
					<span class="shrink-0 font-mono text-red">-{file.removed}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}
