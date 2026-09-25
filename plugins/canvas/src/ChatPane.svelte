<script lang="ts">
  import { StatusBadge } from "@neoworks-dev/ui";
  import { agentFamily, ChatSurface, Composer, type PendingComposer } from "@nib-ui/plugin-chat";
  import { type PaneProps, statusLabel, statusTone } from "@nib-ui/ui-contracts";
  import { SlotHost } from "@nib-ui/ui-contracts/svelte";
  import type { ChatPaneParams } from "./chat-pane";
  import { canvasState } from "./state.svelte";

  /** `session` is the task in the foreground: what a pane opened without params shows. */
  const { session: activeSession, instanceId, params }: PaneProps = $props();

  const target = $derived(
    canvasState.chatTarget(params as ChatPaneParams | undefined, activeSession),
  );
  const workstream = $derived(target.workstream);
  const session = $derived(target.session);
  const view = $derived(workstream ? canvasState.viewOf(workstream) : null);
  // Opening a card lands on its newest turn unless a step row asked for another.
  const anchor = $derived(
    (workstream ? canvasState.anchorFor(workstream.id) : null) ?? view?.anchorMessageId ?? null,
  );
  // A workstream that was never launched has no transcript: its first prompt starts one.
  const launching = $derived(Boolean(workstream) && !workstream?.sessionId);
  const title = $derived(view?.title ?? session?.title ?? "Chat");

  /**
   * The agents this conversation belongs with: the session the user started and
   * everything its agents spawned. One of them is on screen; the rest are tabs
   * on the composer.
   */
  const family = $derived.by(() => {
    if (!session) return [];
    return agentFamily(canvasState.sessions?.summaries ?? [], session.sessionId);
  });

  /**
   * Which member the pane shows is a param, not local state: a pane is restored
   * from its params, and the neighbours that read them — the trajectory
   * inspector — must see the agent being looked at rather than the card's own.
   */
  function showSession(sessionId: string): void {
    canvasState.panes?.reparam(instanceId, { ...params, sessionId });
  }

  function switchAgent(direction: -1 | 1): void {
    if (!session || family.length < 2) return;
    const index = family.findIndex((member) => member.id === session.sessionId);
    if (index < 0) return;
    const next = family[(index + direction + family.length) % family.length];
    if (next) showSession(next.id);
  }

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
   * They belong to the card's own conversation: an agent it spawned, read in the
   * same pane through its tab, is not what the board linked them to.
   */
  const waiting = $derived.by(() => {
    if (!workstream || launching) return null;
    if (session?.sessionId !== workstream.sessionId) return null;
    return canvasState.carriedAttachments(workstream.id);
  });
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
  <header class="flex shrink-0 items-center gap-2 border-b border-line py-2 pr-3 pl-2">
    <span class="min-w-0 flex-1 truncate pl-2 text-xs font-medium text-default">{title}</span>

    {#if session}
      {@const label = statusLabel(session.status)}
      {#if label}
        <StatusBadge tone={statusTone(session.status)}>{label}</StatusBadge>
      {/if}
    {/if}

    <!-- What plugins offer on this conversation: the trajectory inspector lives here. -->
    <SlotHost slot="chat.actions" session={session ?? null} class="flex items-center gap-1" />
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
        {workstream?.goal || "This workstream has no task yet."}
      </p>
      <p class="mt-2 text-2xs text-faint">
        What is sent from here starts it, carrying anything it joins as context.
      </p>
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
        agents={family}
        onSelectAgent={showSession}
        onSwitchAgent={switchAgent}
      />
    </div>
  {:else}
    <p class="min-h-0 flex-1 px-3 py-3 text-xs text-dim">
      {workstream ? "This workstream is not loaded." : "No task is open."}
    </p>
  {/if}
</div>
