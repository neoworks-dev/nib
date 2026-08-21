<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import CpuIcon from 'phosphor-svelte/lib/CpuIcon';
	import PaperPlaneRightIcon from 'phosphor-svelte/lib/PaperPlaneRightIcon';
	import PlugsConnectedIcon from 'phosphor-svelte/lib/PlugsConnectedIcon';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon';
	import StopCircleIcon from 'phosphor-svelte/lib/StopCircleIcon';
	import type { SessionView } from '@nib-ui/protocol';
	import { fuzzyRank } from '../../fuzzy';
	import { applyTrigger, detectTrigger, type TriggerItem } from '../composer-trigger';
	import { clientContext } from '../context';
	import { permissionModeLabel } from '../permission-modes';
	import PillSelect from './PillSelect.svelte';
	import SlotHost from './SlotHost.svelte';
	import TriggerPopup from './TriggerPopup.svelte';

	const { session }: { session: SessionView } = $props();

	const sessions = clientContext().require('sessions');

	let draft = $state('');
	let caret = $state(0);
	let dismissed = $state(false);
	let activeIndex = $state(0);
	let fileMatches = $state<string[]>([]);
	let textarea = $state<HTMLTextAreaElement>();

	const capabilities = $derived(session.capabilities);
	const busy = $derived(session.status === 'working');
	const canInterrupt = $derived(capabilities?.interrupt !== false && busy);
	const harness = $derived(sessions.harnesses.find((entry) => entry.id === session.harnessId));
	// Pre-flight: the harness descriptor answers before the session's own metadata does.
	const permissionModes = $derived(capabilities?.permissionModes ?? harness?.capabilities.permissionModes ?? []);
	const models = $derived(session.models.length > 0 ? session.models : (harness?.models ?? []));

	const trigger = $derived(dismissed ? null : detectTrigger(draft, caret));
	const slashItems = $derived.by((): TriggerItem[] => {
		if (trigger?.kind !== 'slash') return [];
		return fuzzyRank(session.slashCommands, trigger.query, (command) => command.name, 12).map(({ item }) => ({
			value: item.name,
			label: `/${item.name}`,
			hint: item.argumentHint || item.description,
		}));
	});
	const fileItems = $derived(
		trigger?.kind === 'file' ? fileMatches.map((path) => ({ value: path, label: path })) : [],
	);
	const items = $derived(trigger?.kind === 'slash' ? slashItems : fileItems);
	const heading = $derived(trigger?.kind === 'slash' ? 'Slash commands' : 'Workspace files');

	$effect(() => {
		if (trigger?.kind !== 'file') {
			fileMatches = [];
			return;
		}
		// A keystroke can outrun the probe; drop the answer to a query we left behind.
		let current = true;
		void sessions.searchFiles(trigger.query, 12).then((files) => {
			if (current) fileMatches = files;
		});
		return () => {
			current = false;
		};
	});

	$effect(() => {
		items.length;
		activeIndex = 0;
	});

	async function submit() {
		const text = draft.trim();
		if (text.length === 0) return;
		draft = '';
		caret = 0;
		await sessions.send(text);
	}

	/** Text and caret are read off the event together: a stale pair kills the triggers. */
	function onInput(event: Event & { currentTarget: HTMLTextAreaElement }) {
		dismissed = false;
		draft = event.currentTarget.value;
		caret = event.currentTarget.selectionStart ?? draft.length;
	}

	function syncCaret() {
		caret = textarea?.selectionStart ?? draft.length;
	}

	function pick(item: TriggerItem) {
		if (!trigger) return;
		const applied = applyTrigger(draft, trigger, item.value);
		draft = applied.text;
		caret = applied.caret;
		dismissed = true;
		textarea?.focus();
		queueMicrotask(() => textarea?.setSelectionRange(applied.caret, applied.caret));
	}

	function onKeydown(event: KeyboardEvent) {
		if (items.length > 0 && navigatePopup(event)) return;
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void submit();
	}

	function navigatePopup(event: KeyboardEvent): boolean {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const next = activeIndex + (event.key === 'ArrowDown' ? 1 : -1);
			activeIndex = Math.max(0, Math.min(next, items.length - 1));
			return true;
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault();
			pick(items[activeIndex] ?? items[0]!);
			return true;
		}
		if (event.key === 'Escape') {
			dismissed = true;
			return true;
		}
		return false;
	}
</script>

<div class="px-8 pb-5">
	<div
		class="relative flex flex-col gap-2 rounded-2xl border border-line bg-elevated px-3 py-2 focus-within:border-line-strong"
	>
		{#if trigger && items.length > 0}
			<TriggerPopup {items} {activeIndex} {heading} files={trigger.kind === 'file'} onpick={pick} />
		{/if}

		<textarea
			bind:this={textarea}
			value={draft}
			oninput={onInput}
			onkeyup={syncCaret}
			onclick={syncCaret}
			onkeydown={onKeydown}
			rows="2"
			placeholder="Ask for follow-up changes — / for commands, @ for files"
			class="min-h-14 w-full resize-y bg-transparent px-1 py-1 text-base text-default placeholder:text-faint focus:outline-none"
		></textarea>

		<div class="flex flex-wrap items-center gap-2">
			{#if permissionModes.length > 0}
				<PillSelect
					icon={ShieldCheckIcon}
					value={session.permissionMode}
					placeholder="Permission"
					options={permissionModes.map((mode) => ({ value: mode, label: permissionModeLabel(mode), hint: mode }))}
					onChange={(mode) => sessions.setPermissionMode(mode)}
				/>
			{/if}

			{#if models.length > 0}
				<PillSelect
					icon={CpuIcon}
					value={session.model}
					placeholder="Model"
					options={models.map((model) => ({
						value: model.id,
						label: model.displayName ?? model.id,
						hint: model.description,
					}))}
					onChange={(model) => sessions.setModel(model)}
				/>
			{/if}

			{#if sessions.harnesses.length > 1}
				<span class="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted">
					<span class="text-faint"><PlugsConnectedIcon size={12} /></span>
					{harness?.displayName ?? session.harnessId}
				</span>
			{/if}

			<SlotHost slot="composer.actions" {session} class="flex items-center gap-2" />

			<span class="ml-auto">
				{#if canInterrupt}
					<span class="animate-pulse">
						<Button size="sm" variant="danger" icon={StopCircleIcon} onclick={() => sessions.interrupt()}>
							Interrupt
						</Button>
					</span>
				{:else}
					<Button
						size="sm"
						variant="primary"
						icon={PaperPlaneRightIcon}
						disabled={draft.trim().length === 0}
						onclick={submit}>Send</Button
					>
				{/if}
			</span>
		</div>
	</div>
</div>
