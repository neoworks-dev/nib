<script lang="ts">
	import { slide } from 'svelte/transition';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
	import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindowIcon';
	import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
	import type { IconComponent } from '@neoworks-dev/ui';
	import type { SessionView } from '@nib-ui/protocol';
	import { describeCall } from '@nib-ui/ui-contracts';
	import { groupCount, type ToolGroup } from './tool-groups';
	import BlockHost from './BlockHost.svelte';

	const { group, session }: { group: ToolGroup; session: SessionView } = $props();

	const icons: Record<string, IconComponent> = {
		Terminal: TerminalWindowIcon,
		Explore: MagnifyingGlassIcon,
		Edit: PencilSimpleIcon,
		Plan: ListChecksIcon,
		Agent: RobotIcon,
		Web: GlobeIcon,
	};

	/** Matches the dropdown pop-in: fast enough to feel like the panel was already there. */
	const reveal = { duration: 120 };

	let collapsed = $state(false);
	let openBlockId = $state<string | null>(null);

	const Icon = $derived(icons[group.label] ?? WrenchIcon);
	const running = $derived(group.blocks.some((block) => !block.completed));
</script>

<section class="flex flex-col gap-1">
	<button
		type="button"
		class="flex w-fit items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm text-muted hover:bg-hover hover:text-default"
		onclick={() => (collapsed = !collapsed)}
	>
		<span class="shrink-0 {running ? 'animate-pulse text-amber' : 'text-dim'}"><Icon size={16} /></span>
		<span>{group.label}</span>
		<span class="text-faint">·</span>
		<span class="text-dim">{groupCount(group)}</span>
		<span class="text-faint">
			{#if collapsed}
				<CaretUpIcon size={14} />
			{:else}
				<CaretDownIcon size={14} />
			{/if}
		</span>
	</button>

	{#if !collapsed}
		<ul class="ml-3 flex flex-col gap-1 border-l border-line-faint pl-4" transition:slide={reveal}>
			{#each group.blocks as block (block.id)}
				{@const step = describeCall(block)}
				{@const open = openBlockId === block.id}
				<li class="flex min-w-0 flex-col gap-2">
					<button
						type="button"
						class="group flex w-fit max-w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm hover:bg-hover"
						onclick={() => (openBlockId = open ? null : block.id)}
					>
						<span class="shrink-0 text-dim">{step.verb}</span>
						{#if !open && step.detail.length > 0}
							<span class="truncate font-mono text-faint">{step.detail}</span>
						{/if}
						<!-- The caret is the affordance, not decoration: it shows on the row you are pointing at. -->
						<span class="shrink-0 text-faint {open ? '' : 'opacity-0 group-hover:opacity-100'}">
							{#if open}
								<CaretDownIcon size={14} />
							{:else}
								<CaretUpIcon size={14} />
							{/if}
						</span>
					</button>

					{#if open}
						<div transition:slide={reveal}>
							<BlockHost {block} {session} detail />
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
