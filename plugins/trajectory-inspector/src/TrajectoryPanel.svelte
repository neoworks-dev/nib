<script lang="ts">
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import PulseIcon from 'phosphor-svelte/lib/PulseIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import type { SlotProps } from '@nib-ui/ui-contracts';
	import { categorizeEvent, eventCategories, filterEvents, indexBlockKinds } from './filter';
	import EventRow from './EventRow.svelte';
	import PayloadPane from './PayloadPane.svelte';
	import { inspectorState } from './state.svelte';

	const { session }: SlotProps = $props();

	const events = $derived(session ? (inspectorState.sessions?.events(session.sessionId) ?? []) : []);
	const blockKinds = $derived(indexBlockKinds(events));
	const visible = $derived(
		filterEvents(events, { categories: inspectorState.categories, query: inspectorState.query }),
	);
	const selected = $derived(visible.find((event) => event.id === inspectorState.selectedEventId) ?? null);
</script>

<button
	type="button"
	class="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-dim hover:border-line-strong hover:text-default"
	onclick={() => inspectorState.toggle()}
>
	<PulseIcon size={14} />
	Trajectory
	<span class="tabular-nums text-faint">{events.length}</span>
</button>

{#if inspectorState.open}
	<aside
		class="fixed inset-y-0 right-0 z-modal flex w-[44rem] max-w-full flex-col border-l border-line bg-elevated shadow-lg"
	>
		<header class="flex items-center gap-2 border-b border-line px-4 py-3">
			<h2 class="text-sm font-semibold">Trajectory</h2>
			<span class="text-2xs text-faint tabular-nums">{visible.length}/{events.length} events</span>
			<button
				type="button"
				class="ml-auto text-dim hover:text-default"
				aria-label="Close the trajectory inspector"
				onclick={() => inspectorState.toggle(false)}
			>
				<XIcon size={16} />
			</button>
		</header>

		<div class="flex flex-col gap-2 border-b border-line px-4 py-2">
			<div class="flex items-center gap-2 rounded-md border border-line bg-input px-2 py-1.5">
				<span class="text-faint"><MagnifyingGlassIcon size={14} /></span>
				<input
					bind:value={inspectorState.query}
					placeholder="Search types and payloads"
					class="min-w-0 flex-1 bg-transparent text-xs text-default placeholder:text-faint focus:outline-none"
				/>
				{#if inspectorState.query}
					<button
						type="button"
						class="text-faint hover:text-default"
						aria-label="Clear the search"
						onclick={() => (inspectorState.query = '')}
					>
						<XIcon size={12} />
					</button>
				{/if}
			</div>

			<div class="flex flex-wrap gap-1.5">
				{#each eventCategories as category (category.id)}
					<button
						type="button"
						class="rounded-full border px-2 py-0.5 text-2xs {inspectorState.categories.includes(category.id)
							? 'border-action bg-raised text-default'
							: 'border-line text-dim hover:text-default'}"
						onclick={() => inspectorState.toggleCategory(category.id)}
					>
						{category.label}
					</button>
				{/each}
			</div>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto font-mono text-2xs">
			{#each visible as event (event.id)}
				<EventRow
					{event}
					category={categorizeEvent(event, blockKinds)}
					selected={event.id === inspectorState.selectedEventId}
					onselect={() =>
						(inspectorState.selectedEventId = inspectorState.selectedEventId === event.id ? null : event.id)}
				/>
			{/each}
			{#if visible.length === 0}
				<p class="px-4 py-3 font-sans text-xs text-dim">
					{events.length === 0 ? 'No events recorded for this session yet.' : 'No events match the filter.'}
				</p>
			{/if}
		</div>

		{#if selected}
			<div class="flex h-[45%] min-h-0 flex-col">
				<PayloadPane event={selected} />
			</div>
		{/if}
	</aside>
{/if}
