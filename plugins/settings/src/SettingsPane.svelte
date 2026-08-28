<script lang="ts">
	import type { PaneProps } from '@nib-ui/ui-contracts';
	import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon';
	import { settingsState } from './state.svelte';

	const { session }: PaneProps = $props();

	const sections = $derived(settingsState.slots?.entries('settings.section', session) ?? []);
</script>

<div class="flex h-full min-h-0 flex-col">
	<header class="flex items-center gap-2 border-b border-line px-4 py-3">
		<GearSixIcon size={16} />
		<h2 class="text-sm font-semibold">Settings</h2>
	</header>

	<div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
		{#each sections as section, index (index)}
			{@const Section = section.component}
			<Section {session} />
		{/each}

		{#if sections.length === 0}
			<p class="text-xs text-dim">No plugin contributes a settings section.</p>
		{/if}
	</div>
</div>
