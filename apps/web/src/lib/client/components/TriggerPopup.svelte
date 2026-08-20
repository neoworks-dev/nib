<script lang="ts">
	import type { TriggerItem } from '../composer-trigger';

	const {
		items,
		activeIndex,
		heading,
		onpick,
	}: {
		items: TriggerItem[];
		activeIndex: number;
		heading: string;
		onpick: (item: TriggerItem) => void;
	} = $props();
</script>

<div
	class="absolute bottom-full left-0 z-overlay mb-2 w-[28rem] max-w-full overflow-hidden rounded-lg border border-line bg-elevated shadow-lg"
	role="listbox"
	aria-label={heading}
>
	<p class="border-b border-line-faint px-3 py-1.5 text-2xs tracking-caps uppercase text-faint">{heading}</p>
	<ul class="max-h-64 overflow-y-auto py-1">
		{#each items as item, index (item.value)}
			<li>
				<button
					type="button"
					role="option"
					aria-selected={index === activeIndex}
					class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm {index === activeIndex
						? 'bg-hover text-default'
						: 'text-muted'}"
					onclick={() => onpick(item)}
				>
					<span class="truncate font-mono">{item.label}</span>
					{#if item.hint}
						<span class="ml-auto truncate text-xs text-faint">{item.hint}</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</div>
