<script lang="ts">
	import type { SlotProps } from '@nib-ui/ui-contracts';
	import { inspectorState } from './state.svelte';

	const { session }: SlotProps = $props();

	let expanded = $state<string | null>(null);

	const events = $derived(session ? (inspectorState.sessions?.events(session.sessionId) ?? []) : []);
	const types = $derived([...new Set(events.map((event) => event.type))].sort());
	const visible = $derived(
		inspectorState.filter ? events.filter((event) => event.type === inspectorState.filter) : events,
	);
</script>

<button
	type="button"
	class="rounded-md border border-line px-2 py-1 text-xs text-dim hover:text-default"
	onclick={() => inspectorState.toggle()}
>
	Trajectory ({events.length})
</button>

{#if inspectorState.open}
	<aside class="fixed inset-y-0 right-0 z-50 flex w-[34rem] flex-col border-l border-line bg-elevated shadow-lg">
		<header class="flex items-center gap-2 border-b border-line px-4 py-3">
			<h2 class="text-sm font-semibold">Trajectory</h2>
			<select
				bind:value={inspectorState.filter}
				class="ml-auto rounded-md border border-line bg-input px-2 py-1 text-xs text-default"
			>
				<option value="">all types</option>
				{#each types as type (type)}
					<option value={type}>{type}</option>
				{/each}
			</select>
			<button type="button" class="text-dim hover:text-default" onclick={() => inspectorState.toggle(false)}>
				close
			</button>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto px-2 py-2 font-mono text-xs">
			{#each visible as event (event.id)}
				<div class="border-b border-line-faint py-1">
					<button
						type="button"
						class="flex w-full items-center gap-2 text-left"
						onclick={() => (expanded = expanded === event.id ? null : event.id)}
					>
						<span class="w-10 text-right text-faint">{event.seq}</span>
						<span class="text-default">{event.type}</span>
						<span class="ml-auto text-faint">{new Date(event.ts).toLocaleTimeString()}</span>
					</button>
					{#if expanded === event.id}
						<pre class="mt-1 max-h-80 overflow-auto rounded-md bg-input p-2 text-2xs text-muted">{JSON.stringify(
								{ data: event.data, raw: event.raw },
								null,
								2,
							)}</pre>
					{/if}
				</div>
			{/each}
			{#if visible.length === 0}
				<p class="px-2 py-3 text-dim">No events recorded for this session yet.</p>
			{/if}
		</div>
	</aside>
{/if}
