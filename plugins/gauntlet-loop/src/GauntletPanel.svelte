<script lang="ts">
	import { Tooltip } from '@neoworks-dev/ui';
	import ArrowsLeftRightIcon from 'phosphor-svelte/lib/ArrowsLeftRightIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import LinkBreakIcon from 'phosphor-svelte/lib/LinkBreakIcon';
	import SwordIcon from 'phosphor-svelte/lib/SwordIcon';
	import type { PaneProps } from '@nib-ui/ui-contracts';
	import { nextHandoff, peerRole, relayModes, type PaneRole } from './relay';
	import SessionPane from './SessionPane.svelte';
	import { gauntletState } from './state.svelte';

	// The panes pick their own sessions, so the host session is not used here.
	const {}: PaneProps = $props();

	let lastRelay = $state<string | null>(null);

	const mode = $derived(gauntletState.mode);
	const modeInfo = $derived(relayModes.find((entry) => entry.id === mode)!);
	const builder = $derived(gauntletState.builderId ? gauntletState.sessions?.view(gauntletState.builderId) : null);
	const critic = $derived(gauntletState.criticId ? gauntletState.sessions?.view(gauntletState.criticId) : null);

	$effect(() => {
		// Re-evaluated whenever either pane advances; each turn hands off at most once.
		builder?.lastSeq;
		critic?.lastSeq;
		void relay('critic');
		void relay('builder');
	});

	async function relay(from: PaneRole) {
		const sessions = gauntletState.sessions;
		const target = gauntletState.sessionId(peerRole(from));
		if (!sessions || !target) return;

		const handoff = nextHandoff(mode, {
			from,
			view: sessions.view(gauntletState.sessionId(from) ?? '') ?? null,
			relayedMessageId: gauntletState.relayed[from],
		});
		if (!handoff) return;

		gauntletState.relayed = { ...gauntletState.relayed, [from]: handoff.messageId };
		lastRelay = `${from} → ${peerRole(from)}`;
		await sessions.sendTo(target, handoff.text);
	}

	function cycleMode() {
		const index = relayModes.findIndex((entry) => entry.id === mode);
		gauntletState.mode = relayModes[(index + 1) % relayModes.length]!.id;
	}
</script>

<div class="flex h-full min-h-0 flex-col bg-canvas">
		<header class="flex items-center gap-2 border-b border-line px-4 py-2.5">
			<SwordIcon size={16} />
			<h2 class="text-sm font-semibold">Supervised gauntlet</h2>
			<span class="text-2xs text-faint">{modeInfo.hint}</span>
			{#if lastRelay}
				<span class="rounded-full bg-raised px-2 py-0.5 text-2xs text-muted">last handoff: {lastRelay}</span>
			{/if}
		</header>

		<div class="flex min-h-0 flex-1 items-stretch gap-0">
			<SessionPane role="builder" title="Builder" tone="blue" />

			<div class="flex w-16 shrink-0 flex-col items-center justify-center gap-2 border-y border-line bg-elevated">
				<Tooltip text={modeInfo.label}>
					<button
						type="button"
						class="flex h-10 w-10 items-center justify-center rounded-full border {mode === 'off'
							? 'border-line text-faint'
							: 'border-green text-green'}"
						aria-label="Communication: {modeInfo.label}"
						onclick={cycleMode}
					>
						{#if mode === 'off'}
							<LinkBreakIcon size={18} />
						{:else if mode === 'critic-to-builder'}
							<ArrowRightIcon size={18} />
						{:else}
							<ArrowsLeftRightIcon size={18} />
						{/if}
					</button>
				</Tooltip>
				<span class="px-1 text-center text-2xs leading-tight text-faint">{modeInfo.label}</span>
			</div>

			<SessionPane role="critic" title="Critic" tone="violet" />
		</div>
	</div>
