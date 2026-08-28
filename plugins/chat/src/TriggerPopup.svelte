<script lang="ts">
	import { FileIcon } from '@nib-ui/file-icons';
	import type { TriggerItem } from './composer-trigger';

	const {
		items,
		activeIndex,
		heading,
		files = false,
		onpick,
	}: {
		items: TriggerItem[];
		activeIndex: number;
		heading: string;
		/** File rows get the Material icon for their extension; commands do not. */
		files?: boolean;
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
					class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm {index === activeIndex
						? 'bg-hover text-default'
						: 'text-muted'}"
					onclick={() => onpick(item)}
				>
					{#if files}
						<FileIcon path={item.value} size={14} />
					{/if}
					<span class="max-w-[65%] shrink-0 truncate font-mono">{item.label}</span>
					{#if item.hint}
						<!-- The name is the thing being picked, so the description gives up the space. -->
						<span class="min-w-0 flex-1 truncate text-right text-xs text-faint">{item.hint}</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</div>
