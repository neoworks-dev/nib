<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import PaperPlaneRightIcon from 'phosphor-svelte/lib/PaperPlaneRightIcon';
	import { canvasState } from './state.svelte';
	import { isWorkstream } from './workstream';

	const sheet = $derived(canvasState.sheet);
	const anchor = $derived.by(() => {
		const object = sheet?.anchorId ? canvasState.board.find(sheet.anchorId) : null;
		return object && isWorkstream(object) ? object : null;
	});
	const anchorTitle = $derived(anchor ? canvasState.viewOf(anchor).title : '');

	const heading = $derived(sheet?.kind === 'fork' ? 'Fork this workstream' : 'New workstream');

	const hint = $derived(
		sheet?.kind === 'fork'
			? 'A task continuing this one’s session, with everything it already knows.'
			: 'A goal on the board. Sending starts it; leaving it empty just places the card.',
	);

	let draft = $state('');

	$effect(() => {
		sheet;
		draft = '';
	});

	async function submit() {
		const text = draft.trim();
		const current = sheet;
		if (!current) return;
		canvasState.closeSheet();

		if (current.kind === 'fork' && current.anchorId) {
			if (text.length === 0) return;
			await canvasState.forkFrom(current.anchorId, text, { at: current.at });
			return;
		}

		const id = canvasState.createWorkstream(text, current.at ?? { x: 0, y: 0 });
		if (text.length > 0) await canvasState.launch(id, text);
	}

	/** A workstream can be placed without being started; the others need a prompt. */
	function place() {
		const current = sheet;
		if (!current || current.kind !== 'workstream') return;
		canvasState.closeSheet();
		const id = canvasState.createWorkstream(draft, current.at ?? { x: 0, y: 0 });
		canvasState.open(id);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			canvasState.closeSheet();
			return;
		}
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void submit();
	}
</script>

{#if sheet}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="absolute inset-0 z-modal flex items-center justify-center bg-black/40 p-6"
		onclick={(event) => event.target === event.currentTarget && canvasState.closeSheet()}
	>
		<div class="flex w-[520px] max-w-full flex-col gap-2 rounded-2xl border border-line bg-elevated px-4 py-3.5">
			<div class="flex items-baseline gap-2">
				<h2 class="text-xs font-medium text-default">{heading}</h2>
				<p class="text-2xs text-dim">{hint}</p>
			</div>

			{#if anchor}
				<p class="truncate rounded-md bg-raised px-2 py-1 text-2xs text-muted">from “{anchorTitle}”</p>
			{/if}

			<!-- svelte-ignore a11y_autofocus -->
			<textarea
				bind:value={draft}
				rows="4"
				autofocus
				placeholder="What should this workstream do?"
				onkeydown={onKeydown}
				class="w-full resize-none rounded-lg border border-line bg-input px-2.5 py-2 text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
			></textarea>

			<div class="flex items-center gap-2">
				<span class="text-2xs text-faint">Enter to send · Shift+Enter for a new line</span>
				<span class="ml-auto flex items-center gap-2">
					{#if sheet.kind === 'workstream'}
						<Button size="sm" variant="ghost" onclick={place}>Place only</Button>
					{:else}
						<Button size="sm" variant="ghost" onclick={() => canvasState.closeSheet()}>Cancel</Button>
					{/if}
					<Button
						size="sm"
						variant="primary"
						icon={PaperPlaneRightIcon}
						disabled={draft.trim().length === 0 || canvasState.busy}
						onclick={submit}
					>
						Send
					</Button>
				</span>
			</div>
		</div>
	</div>
{/if}
