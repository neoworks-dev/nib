<script lang="ts">
	import type { AnyAgentEvent } from '@nib-ui/protocol';
	import { eventSummary, type EventCategory } from './filter';

	const {
		event,
		category,
		selected,
		onselect,
	}: {
		event: AnyAgentEvent;
		category: EventCategory;
		selected: boolean;
		onselect: () => void;
	} = $props();

	const categoryTone: Record<EventCategory, string> = {
		error: 'text-red',
		tool: 'text-blue',
		stream: 'text-violet',
		state: 'text-green',
		other: 'text-faint',
	};
</script>

<button
	type="button"
	onclick={onselect}
	class="flex w-full items-baseline gap-2 border-l-2 px-2 py-1 text-left {selected
		? 'border-action bg-hover'
		: 'border-transparent hover:bg-hover'}"
>
	<span class="w-8 shrink-0 text-right text-faint tabular-nums">{event.seq}</span>
	<span class="shrink-0 {categoryTone[category]}">{event.type}</span>
	<span class="truncate text-faint">{eventSummary(event)}</span>
	<span class="ml-auto shrink-0 text-faint tabular-nums">{new Date(event.ts).toLocaleTimeString()}</span>
</button>
