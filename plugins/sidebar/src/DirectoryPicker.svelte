<script lang="ts">
	import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import type { DirectoryEntry } from '@nib-ui/ui-contracts';
	import { sidebarState } from './state.svelte';

	const {
		value,
		recent,
		onChange,
		onSubmit,
	}: {
		value: string;
		recent: string[];
		onChange: (value: string) => void;
		/** A directory the user settled on, rather than one they are typing through. */
		onSubmit: (value: string) => void;
	} = $props();

	interface Suggestion {
		path: string;
		label: string;
		fromHistory: boolean;
	}

	let open = $state(false);
	let entries = $state<DirectoryEntry[]>([]);
	let activeIndex = $state(0);

	const suggestions = $derived.by((): Suggestion[] => {
		if (value.trim().length === 0) {
			return recent.map((path) => ({ path, label: path, fromHistory: true }));
		}
		return entries.map((entry) => ({ path: entry.path, label: entry.path, fromHistory: false }));
	});

	$effect(() => {
		const query = value;
		if (query.trim().length === 0) {
			entries = [];
			return;
		}
		let current = true;
		void sidebarState.sessions?.listDirectories(query).then((listing) => {
			if (current) entries = listing.entries;
		});
		return () => {
			current = false;
		};
	});

	$effect(() => {
		suggestions.length;
		activeIndex = 0;
	});

	function choose(suggestion: Suggestion) {
		// A path out of the history is one the user already worked in, so it opens;
		// one out of the listing keeps the picker open so its children can be walked.
		if (suggestion.fromHistory) {
			onSubmit(suggestion.path);
			open = false;
			return;
		}
		onChange(`${suggestion.path}/`);
		open = true;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (!open || suggestions.length === 0)) {
			event.preventDefault();
			if (value.trim().length > 0) onSubmit(value.trim());
			return;
		}
		if (!open || suggestions.length === 0) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const next = activeIndex + (event.key === 'ArrowDown' ? 1 : -1);
			activeIndex = Math.max(0, Math.min(next, suggestions.length - 1));
			return;
		}
		if (event.key === 'Enter' && suggestions[activeIndex]) {
			event.preventDefault();
			choose(suggestions[activeIndex]);
			return;
		}
		if (event.key === 'Escape') open = false;
	}
</script>

<div class="relative">
	<div class="flex items-center gap-2 rounded-lg border border-line bg-input px-2 py-1.5 focus-within:border-line-strong">
		<span class="text-muted"><FolderOpenIcon size={14} /></span>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			{value}
			autofocus
			oninput={(event) => {
				open = true;
				onChange(event.currentTarget.value);
			}}
			onfocus={() => (open = true)}
			onblur={() => setTimeout(() => (open = false), 120)}
			onkeydown={onKeydown}
			placeholder="Project directory"
			spellcheck="false"
			class="min-w-0 flex-1 bg-transparent font-mono text-xs text-default placeholder:text-faint focus:outline-none"
		/>
	</div>

	{#if open && suggestions.length > 0}
		<ul
			class="absolute top-full left-0 z-overlay mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-elevated py-1 shadow-lg"
		>
			{#each suggestions as suggestion, index (suggestion.path)}
				<li>
					<button
						type="button"
						class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs {index === activeIndex
							? 'bg-hover text-default'
							: 'text-muted'}"
						onclick={() => choose(suggestion)}
					>
						<span class="shrink-0 text-faint">
							{#if suggestion.fromHistory}
								<ClockCounterClockwiseIcon size={14} />
							{:else}
								<FolderOpenIcon size={14} />
							{/if}
						</span>
						<span class="truncate font-mono">{suggestion.label}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
