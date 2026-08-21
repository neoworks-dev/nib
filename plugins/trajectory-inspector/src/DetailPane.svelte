<script lang="ts">
	import JsonNode from './JsonNode.svelte';
	import { mergeDeltas } from './merge-deltas';
	import type { TraceNode } from './trace';

	const { node }: { node: TraceNode } = $props();

	const tabs = ['Summary', 'Payload', 'Result', 'Raw'] as const;
	let tab = $state<(typeof tabs)[number]>('Summary');

	const rows = $derived(mergeDeltas(node.events));
	const last = $derived(node.events[node.events.length - 1]);
</script>

<div class="flex min-h-0 flex-col border-t border-line">
	<nav class="flex items-center gap-1 border-b border-line-faint px-2 py-1.5">
		{#each tabs as name (name)}
			<button
				type="button"
				class="rounded-md px-2 py-0.5 text-2xs {tab === name ? 'bg-raised text-default' : 'text-dim hover:text-default'}"
				onclick={() => (tab = name)}
			>
				{name}
			</button>
		{/each}
		<span class="ml-auto text-2xs text-faint">Turn {node.turn}{node.step > 0 ? ` · Step ${node.step}` : ''}</span>
	</nav>

	<div class="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-2xs">
		{#if tab === 'Summary'}
			<dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
				<dt class="text-dim">Kind</dt>
				<dd class="text-default">{node.kind}</dd>
				<dt class="text-dim">Title</dt>
				<dd class="text-default">{node.title}</dd>
				<dt class="text-dim">Status</dt>
				<dd class={node.status === 'error' ? 'text-red' : 'text-green'}>{node.status}</dd>
				<dt class="text-dim">Seq</dt>
				<dd class="text-default">{node.seq}{last && last.seq !== node.seq ? `–${last.seq}` : ''}</dd>
				<dt class="text-dim">Started</dt>
				<dd class="text-default">{new Date(node.ts).toLocaleTimeString()}</dd>
				<dt class="text-dim">Duration</dt>
				<dd class="text-default">{node.durationMs === null ? '—' : `${node.durationMs} ms`}</dd>
				<dt class="text-dim">Events</dt>
				<dd class="text-default">{node.events.length}</dd>
			</dl>
		{:else if tab === 'Payload'}
			<pre class="whitespace-pre-wrap text-muted">{node.detail || '—'}</pre>
		{:else if tab === 'Result'}
			<pre class="whitespace-pre-wrap {node.status === 'error' ? 'text-red' : 'text-muted'}">{node.result ?? '—'}</pre>
		{:else}
			{#each rows as row (row.event.id)}
				<div class="mb-2 border-b border-line-faint pb-2 last:border-b-0">
					<p class="text-faint">
						{row.firstSeq === row.event.seq ? row.event.seq : `${row.firstSeq}–${row.event.seq}`}
						· {row.event.type}{row.mergedCount > 1 ? ` ×${row.mergedCount}` : ''}
					</p>
					<JsonNode label="data" value={row.event.data} />
					{#if row.event.raw !== undefined}
						<JsonNode label="raw" value={row.event.raw} />
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
