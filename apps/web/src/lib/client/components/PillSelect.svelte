<script lang="ts">
	import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDownIcon';
	import type { IconComponent } from '@neoworks-dev/ui';
	import type { PillOption } from './pill';

	const {
		icon: Icon,
		value,
		options,
		placeholder = 'Select',
		onChange,
	}: {
		icon?: IconComponent;
		value: string | null;
		options: PillOption[];
		placeholder?: string;
		onChange: (value: string) => void;
	} = $props();

	let open = $state(false);

	const selected = $derived(options.find((option) => option.value === value));

	function pick(option: PillOption) {
		open = false;
		if (option.value !== value) onChange(option.value);
	}
</script>

<div class="relative" onfocusout={(event) => {
	if (!event.currentTarget.contains(event.relatedTarget as Node | null)) open = false;
}}>
	<button
		type="button"
		class="flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1 text-xs text-muted transition-colors duration-fast hover:border-line-strong hover:text-default"
		onclick={() => (open = !open)}
	>
		{#if Icon}
			<span class="text-faint"><Icon size={12} /></span>
		{/if}
		<span class="max-w-40 truncate">{selected?.label ?? placeholder}</span>
		<span class="text-faint"><CaretUpDownIcon size={12} /></span>
	</button>

	{#if open}
		<ul
			class="absolute bottom-full left-0 z-overlay mb-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-line bg-elevated py-1 shadow-lg"
		>
			{#each options as option (option.value)}
				<li>
					<button
						type="button"
						class="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-xs {option.value === value
							? 'bg-hover text-default'
							: 'text-muted hover:bg-hover'}"
						onclick={() => pick(option)}
					>
						<span>{option.label}</span>
						{#if option.hint}
							<span class="truncate text-2xs text-faint">{option.hint}</span>
						{/if}
					</button>
				</li>
			{/each}
			{#if options.length === 0}
				<li class="px-3 py-1.5 text-2xs text-faint">Nothing to choose yet.</li>
			{/if}
		</ul>
	{/if}
</div>
