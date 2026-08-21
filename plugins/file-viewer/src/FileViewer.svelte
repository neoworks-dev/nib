<script lang="ts">
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { FileIcon } from '@nib-ui/file-icons';
	import type { PaneProps } from '@nib-ui/ui-contracts';
	import { highlightLines, languageFor } from './highlight';
	import { fileViewerState } from './state.svelte';
	import './theme.css';

	const { session }: PaneProps = $props();

	const active = $derived(fileViewerState.active);
	const lines = $derived(active ? highlightLines(active.text, active.path) : []);
	const language = $derived(active ? (languageFor(active.path) ?? 'text') : '');
	const workspace = $derived(session?.cwd?.slice(session.cwd.lastIndexOf('/') + 1) ?? 'workspace');
</script>

<div class="flex h-full min-h-0 flex-col">
	{#if fileViewerState.tabs.length === 0}
		<p class="px-3 py-2 text-xs text-dim">Open a file from the browser or a diff to view it here.</p>
	{:else}
		<div class="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
			{#each fileViewerState.tabs as tab (tab.path)}
				<div
					class="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs {tab.path ===
					fileViewerState.activePath
						? 'bg-raised text-default'
						: 'text-dim hover:bg-hover'}"
				>
					<button
						type="button"
						class="flex items-center gap-1.5"
						onclick={() => (fileViewerState.activePath = tab.path)}
					>
						<FileIcon path={tab.path} size={13} />
						{tab.path.slice(tab.path.lastIndexOf('/') + 1)}
					</button>
					<button
						type="button"
						class="text-faint hover:text-default"
						aria-label="Close {tab.path}"
						onclick={() => fileViewerState.close(tab.path)}
					>
						<XIcon size={11} />
					</button>
				</div>
			{/each}
		</div>

		{#if active}
			<div class="flex items-center gap-1.5 border-b border-line-faint px-3 py-1.5 text-2xs text-dim">
				<span>{workspace}</span>
				<CaretRightIcon size={10} />
				<FileIcon path={active.path} size={12} />
				<span class="truncate font-mono text-default">{active.path}</span>
				<span class="ml-auto text-faint">{language} · {lines.length} lines</span>
			</div>

			<div class="hljs-surface min-h-0 flex-1 overflow-auto font-mono text-xs">
				{#each lines as line, index (index)}
					<div class="flex">
						<span
							class="w-12 shrink-0 border-r border-line-faint bg-surface px-2 py-px text-right text-faint tabular-nums select-none"
						>
							{index + 1}
						</span>
						<code class="flex-1 px-3 py-px whitespace-pre">{@html line || ' '}</code>
					</div>
				{/each}
			</div>
		{/if}

	{/if}

	{#if fileViewerState.error}
		<p class="border-t border-line px-3 py-2 text-xs text-red">{fileViewerState.error}</p>
	{/if}
</div>
