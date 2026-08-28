<script lang="ts">
	import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDownIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import type { IconComponent } from '@neoworks-dev/ui';
	import { fuzzyRank } from '../fuzzy';
	import type { PillOption } from './pill';

	const {
		icon: Icon,
		value,
		options,
		actions = [],
		placeholder = 'Select',
		searchPlaceholder = 'Search',
		searchable = false,
		placement = 'top',
		onChange,
	}: {
		icon?: IconComponent;
		value: string | null;
		options: PillOption[];
		/** Rows below the divider that trigger a flow instead of selecting a value. */
		actions?: PillOption[];
		placeholder?: string;
		searchPlaceholder?: string;
		searchable?: boolean;
		placement?: 'top' | 'bottom';
		onChange: (value: string) => void;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let search = $state<HTMLInputElement>();

	const selected = $derived(options.find((option) => option.value === value));
	const visible = $derived(
		query.trim().length === 0
			? options
			: fuzzyRank(options, query, (option) => `${option.label} ${option.hint ?? ''}`, 50).map(({ item }) => item),
	);

	$effect(() => {
		if (!open) return;
		query = '';
		search?.focus();
	});

	function pick(option: PillOption) {
		if (option.disabled) return;
		open = false;
		if (option.value !== value) onChange(option.value);
	}

	function run(action: PillOption) {
		if (action.disabled) return;
		open = false;
		onChange(action.value);
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
		{#if selected?.icon}
			{@const SelectedIcon = selected.icon}
			<span class="text-muted"><SelectedIcon size={12} /></span>
		{:else if Icon}
			<span class="text-faint"><Icon size={12} /></span>
		{/if}
		<span class="max-w-40 truncate">{selected?.label ?? placeholder}</span>
		<span class="text-faint"><CaretUpDownIcon size={12} /></span>
	</button>

	{#if open}
		<div
			data-placement={placement}
			class="pop-in absolute left-0 z-overlay flex w-64 flex-col gap-1 overflow-hidden rounded-xl border border-line-strong bg-raised p-1 shadow-xs {placement ===
			'top'
				? 'bottom-full mb-1'
				: 'top-full mt-1'}"
		>
			{#if searchable}
				<div class="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5">
					<span class="text-faint"><MagnifyingGlassIcon size={14} /></span>
					<input
						bind:this={search}
						bind:value={query}
						type="text"
						placeholder={searchPlaceholder}
						onkeydown={(event) => {
							if (event.key === 'Escape') open = false;
							if (event.key === 'Enter' && visible[0]) pick(visible[0]);
						}}
						class="w-full bg-transparent text-xs text-default placeholder:text-faint focus:outline-none"
					/>
				</div>
			{/if}

			<ul class="flex max-h-72 flex-col gap-1 overflow-y-auto">
				{#each visible as option (option.value)}
					{@const OptionIcon = option.icon}
					<li>
						<button
							type="button"
							disabled={option.disabled}
							class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs {option.disabled
								? 'cursor-default text-faint'
								: option.value === value
									? 'bg-hover text-default'
									: 'text-muted hover:bg-hover'}"
							onclick={() => pick(option)}
						>
							{#if OptionIcon}
								<span class="shrink-0"><OptionIcon size={14} /></span>
							{/if}
							<span class="flex min-w-0 flex-col gap-0.5">
								<span class="truncate">{option.label}</span>
								{#if option.hint}
									<span class="truncate text-2xs text-faint">{option.hint}</span>
								{/if}
							</span>
							{#if option.disabled}
								<span class="ml-auto shrink-0 rounded-full bg-raised px-1.5 py-px text-2xs text-faint">Soon</span>
							{:else if option.value === value}
								<span class="ml-auto shrink-0 text-muted"><CheckIcon size={12} /></span>
							{/if}
						</button>
					</li>
				{/each}
				{#if visible.length === 0}
					<li class="px-2 py-1.5 text-2xs text-faint">Nothing to choose yet.</li>
				{/if}
			</ul>

			{#if actions.length > 0}
				<ul class="flex flex-col gap-1 border-t border-line pt-1">
					{#each actions as action (action.value)}
						{@const ActionIcon = action.icon}
						<li>
							<button
								type="button"
								disabled={action.disabled}
								class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs {action.disabled
									? 'cursor-default text-faint'
									: 'text-muted hover:bg-hover'}"
								onclick={() => run(action)}
							>
								{#if ActionIcon}
									<span class="shrink-0"><ActionIcon size={14} /></span>
								{/if}
								<span class="truncate">{action.label}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* Clipped reveal rather than a scale: the rows stay crisp while the panel
	   unfolds from the corner the trigger sits at. */
	.pop-in {
		animation: unfold-down 60ms ease-out;
	}

	.pop-in[data-placement='top'] {
		animation-name: unfold-up;
	}

	@keyframes unfold-down {
		from {
			opacity: 0;
			clip-path: inset(0 100% 100% 0 round 0.75rem);
		}
		to {
			opacity: 1;
			clip-path: inset(0 0 0 0 round 0.75rem);
		}
	}

	@keyframes unfold-up {
		from {
			opacity: 0;
			clip-path: inset(100% 100% 0 0 round 0.75rem);
		}
		to {
			opacity: 1;
			clip-path: inset(0 0 0 0 round 0.75rem);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pop-in {
			animation: none;
		}
	}
</style>
