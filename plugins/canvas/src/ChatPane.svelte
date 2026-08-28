<script lang="ts">
	import { StatusBadge } from '@neoworks-dev/ui';
	import { ChatSurface, Composer, type PendingComposer } from '@nib-ui/plugin-chat';
	import { statusLabel, statusTone, type PaneProps } from '@nib-ui/ui-contracts';
	import type { ChatPaneParams } from './chat-pane';
	import { canvasState } from './state.svelte';

	/** `session` is the task in the foreground: what a pane opened without params shows. */
	const { session: activeSession, params }: PaneProps = $props();

	const target = $derived(canvasState.chatTarget(params as ChatPaneParams | undefined, activeSession));
	const workstream = $derived(target.workstream);
	const session = $derived(target.session);
	const view = $derived(workstream ? canvasState.viewOf(workstream) : null);
	// Opening a card lands on its newest turn unless a step row asked for another.
	const anchor = $derived((workstream ? canvasState.anchorFor(workstream.id) : null) ?? view?.anchorMessageId ?? null);
	// A workstream that was never launched has no transcript: its first prompt starts one.
	const launching = $derived(Boolean(workstream) && !workstream?.sessionId);
	const title = $derived(view?.title ?? session?.title ?? 'Chat');

	/**
	 * The same composer a running task gets. The picks it makes are held on the
	 * card until the first prompt starts the session with them.
	 */
	const settings = $derived(workstream && launching ? canvasState.settingsFor(workstream) : null);
	/** What this task carries: the workstreams it came from, and the files linked to it. */
	const sources = $derived(workstream ? canvasState.sourcesOf(workstream.id) : []);
	/**
	 * Files linked to a running task that it has not been sent yet. They ride the
	 * next prompt, and the links they came in on are marked once they have gone.
	 */
	const waiting = $derived(workstream && !launching ? canvasState.carriedAttachments(workstream.id) : null);
	const pending = $derived.by((): PendingComposer | null => {
		const card = workstream;
		if (!card || !settings) return null;
		return {
			id: card.id,
			harnessId: settings.harnessId,
			model: settings.model,
			permissionMode: settings.permissionMode,
			effort: settings.effort,
			busy: canvasState.busy,
			setHarness: (harnessId) => canvasState.configure(card.id, { harnessId }),
			setModel: (model) => canvasState.configure(card.id, { model }),
			setPermissionMode: (permissionMode) => canvasState.configure(card.id, { permissionMode }),
			setEffort: (effort) => canvasState.configure(card.id, { effort }),
			start: (text) => canvasState.launch(card.id, text),
		};
	});
</script>

<div class="flex h-full min-h-0 flex-col">
	<header class="flex shrink-0 items-center gap-2 border-b border-line py-2 pr-3 pl-4">
		<span class="min-w-0 flex-1 truncate text-xs font-medium text-default">{title}</span>

		{#if session}
			{@const label = statusLabel(session.status)}
			{#if label}
				<StatusBadge tone={statusTone(session.status)}>{label}</StatusBadge>
			{/if}
		{/if}
	</header>

	{#if pending}
		<!-- No transcript yet: what is sent from here is what creates the session,
		     so the composer is the same one, with its picks applied at launch. -->
		<div class="min-h-0 flex-1 overflow-y-auto px-8 py-3">
			{#if sources.length > 0}
				<!-- What this task is joined to, named before it runs: sending carries them. -->
				<div class="mb-2 flex flex-wrap items-center gap-1.5">
					<span class="text-2xs text-faint">Carries</span>
					{#each sources as source (source.id)}
						<button
							type="button"
							class="max-w-52 truncate rounded-full border border-line bg-raised px-2 py-0.5 text-2xs text-muted hover:text-default"
							onclick={() => canvasState.open(source.id)}
						>
							{source.title}
						</button>
					{/each}
				</div>
			{/if}

			<p class="text-xs text-dim">
				{workstream?.goal || 'This workstream has no task yet.'}
			</p>
			<p class="mt-2 text-2xs text-faint">What is sent from here starts it, carrying anything it joins as context.</p>
		</div>

		<div class="shrink-0">
			<Composer {pending} />
		</div>
	{:else if session}
		{#if sources.length > 0}
			<!-- What the board linked to this task; the unsent files ride the next prompt. -->
			<div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-4 py-1.5">
				<span class="text-2xs text-faint">Carries</span>
				{#each sources as source (source.id)}
					<button
						type="button"
						class="max-w-52 truncate rounded-full border border-line bg-raised px-2 py-0.5 text-2xs text-muted hover:text-default"
						onclick={() => canvasState.open(source.id)}
					>
						{source.title}
					</button>
				{/each}
			</div>
		{/if}

		<div class="min-h-0 flex-1">
			<ChatSurface
				{session}
				scrollToMessageId={anchor}
				annotations={canvasState.annotationsFor(session.sessionId)}
				attachments={waiting?.attachments ?? []}
				onAnnotationAdd={(annotation) => canvasState.pinAnnotation(annotation)}
				onAnnotationRemove={(annotationId) => canvasState.unpinAnnotation(annotationId)}
				onAttachmentsSent={() => canvasState.markCarried(waiting?.edgeIds ?? [])}
			/>
		</div>
	{:else}
		<p class="min-h-0 flex-1 px-3 py-3 text-xs text-dim">
			{workstream ? 'This workstream is not loaded.' : 'No task is open.'}
		</p>
	{/if}
</div>
