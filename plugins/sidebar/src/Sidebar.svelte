<script lang="ts">
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon';
	import { StatusBadge } from '@neoworks-dev/ui';
	import { desktopBridge, statusLabel, statusTone, type SlotProps } from '@nib-ui/ui-contracts';
	import DirectoryPicker from './DirectoryPicker.svelte';
	import { sidebarState } from './state.svelte';
	import type { WorkstreamRow } from './projects';
	import WorkspaceBadge from './WorkspaceBadge.svelte';

	// The list follows the board index and the session store, not the open task.
	const {}: SlotProps = $props();

	let picking = $state(false);
	let draft = $state('');

	const projects = $derived(sidebarState.projects);
	const openPath = $derived(sidebarState.openPath);
	const recent = $derived(sidebarState.sessions?.recentDirectories ?? []);

	/** Native chooser when the desktop shell is there; the typed picker is the fallback. */
	async function browse() {
		const bridge = desktopBridge();
		if (!bridge) {
			picking = !picking;
			draft = '';
			return;
		}
		const picked = await bridge.pickDirectory(openPath || undefined);
		if (picked) await sidebarState.open(picked);
	}

	async function submit(path: string) {
		picking = false;
		draft = '';
		await sidebarState.open(path.replace(/(.)\/+$/, '$1'));
	}

	/** A workstream that is doing something says so; an idle one is just a row. */
	function badge(row: WorkstreamRow): { tone: ReturnType<typeof statusTone>; label: string } | null {
		if (!row.status) return { tone: 'neutral', label: 'Not started' };
		const label = statusLabel(row.status);
		return label ? { tone: statusTone(row.status), label } : null;
	}
</script>

{#if sidebarState.collapsed}
	<aside class="flex h-full w-10 shrink-0 flex-col items-center rounded-xl border border-line bg-elevated py-2">
		<button
			type="button"
			class="rounded-md p-1 text-faint hover:bg-hover hover:text-default"
			aria-label="Show the project list"
			onclick={() => sidebarState.setCollapsed(false)}
		>
			<SidebarSimpleIcon size={16} />
		</button>
	</aside>
{:else}
	<aside
		class="flex h-full min-h-0 w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-elevated"
	>
		<div class="flex items-center gap-1 px-2 py-2">
			<span class="px-1 text-xs font-medium text-dim">Projects</span>
			<button
				type="button"
				class="ml-auto rounded-md p-1 text-faint hover:bg-hover hover:text-default"
				aria-label="Open a project folder"
				aria-pressed={picking}
				onclick={browse}
			>
				<FolderOpenIcon size={15} />
			</button>
			<button
				type="button"
				class="rounded-md p-1 text-faint hover:bg-hover hover:text-default"
				aria-label="Hide the project list"
				onclick={() => sidebarState.setCollapsed(true)}
			>
				<SidebarSimpleIcon size={16} />
			</button>
		</div>

		{#if picking}
			<div class="px-2 pb-2">
				<DirectoryPicker value={draft} {recent} onChange={(value) => (draft = value)} onSubmit={submit} />
			</div>
		{/if}

		{#if sidebarState.error}
			<p class="px-3 pb-2 text-2xs text-red">{sidebarState.error}</p>
		{/if}

		<div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
			{#each projects as project (project.path)}
				<section class="mb-1">
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left {project.path === openPath
							? 'bg-hover text-default'
							: 'text-muted hover:bg-hover hover:text-default'}"
						onclick={() => sidebarState.open(project.path)}
						title={project.path}
					>
						<WorkspaceBadge path={project.path} name={project.name} />
						<span class="min-w-0 flex-1 truncate text-sm">{project.name}</span>
						{#if project.activeCount > 0}
							<StatusBadge tone="blue">{project.activeCount}</StatusBadge>
						{/if}
					</button>

					<ul class="ml-3 border-l border-line pl-1.5">
						{#each project.workstreams as row (row.id)}
							{@const tag = badge(row)}
							<li class="group flex items-center gap-1">
								<button
									type="button"
									class="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-xs text-dim hover:bg-hover hover:text-default"
									onclick={() => sidebarState.openWorkstream(row)}
									title={row.title}
								>
									{row.title}
								</button>
								{#if tag}
									<StatusBadge tone={tag.tone}>{tag.label}</StatusBadge>
								{/if}
								{#if !row.active}
									<button
										type="button"
										class="rounded-md p-1 text-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-default"
										aria-label="Mark reviewed"
										title="Mark reviewed"
										onclick={() => sidebarState.review(row, true)}
									>
										<CheckIcon size={12} />
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				<p class="px-2.5 py-3 text-xs text-dim">No projects yet — open a folder to start one.</p>
			{/each}
		</div>
	</aside>
{/if}
