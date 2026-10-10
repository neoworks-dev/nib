<script lang="ts">
  import { StatusBadge } from "@neoworks-dev/ui";
  import { agentFamily, ChatSurface, Composer, type PendingComposer } from "@nib-ui/plugin-chat";
  import { type PaneProps, statusLabel, statusTone } from "@nib-ui/ui-contracts";
  import { SlotHost } from "@nib-ui/ui-contracts/svelte";
  import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
  import NotePencilIcon from "phosphor-svelte/lib/NotePencilIcon";
  import { untrack } from "svelte";
  import { chatList, groupChats } from "./chat-list";
  import ChatList from "./ChatList.svelte";
  import type { ChatPaneParams } from "./chat-pane";
  import { canvasState } from "./state.svelte";

  const { instanceId, params }: PaneProps = $props();

  const chatParams = $derived(params as ChatPaneParams | undefined);
  /** A pane opened on no chat in particular is the overview of all of them. */
  const listing = $derived(!chatParams?.workstreamId && !chatParams?.sessionId);
  const target = $derived(canvasState.chatTarget(chatParams, null));
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

  /** Back to the overview: the pane drops what it was keyed to. */
  function showOverview(): void {
    canvasState.panes?.reparam(instanceId, {});
  }

  /** A chat picked from the overview. */
  function openChat(sessionId: string): void {
    canvasState.panes?.reparam(instanceId, { sessionId } satisfies ChatPaneParams);
  }

  // The session the pane is keyed to is subscribed to, whether it was picked
  // from the overview or restored with the pane: a chat nobody has opened this
  // run has a log and no live projection until something watches it.
  $effect(() => {
    const sessionId = chatParams?.sessionId;
    if (!sessionId) return;
    untrack(() => canvasState.sessions?.watch(sessionId));
  });

  /**
   * The arrows of an empty composer. Left steps back through the agents of a
   * family and, from the one the user started, out to the overview; right steps
   * forward and wraps.
   */
  function switchAgent(direction: -1 | 1): void {
    const index = family.findIndex((member) => member.id === session?.sessionId);
    if (direction === -1 && index <= 0) {
      showOverview();
      return;
    }
    if (family.length < 2 || index < 0) return;
    const next = family[(index + direction) % family.length];
    if (next) showSession(next.id);
  }

  const chats = $derived(chatList(canvasState.sessions?.summaries ?? [], canvasState.board.cwd));
  const runningCount = $derived(chats.filter((chat) => chat.running).length);
  /** Re-read each minute so the ages on the overview do not go stale. */
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

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

  /**
   * The composer for a chat that does not exist yet, shown while the pane has no
   * conversation. Keyed by directory so a draft belongs to the project it was
   * written for. Sending pins the pane to the session it started.
   */
  const newChat = $derived.by((): PendingComposer => {
    const settings = canvasState.boardSettings;
    return {
      id: `board:${canvasState.board.cwd}`,
      harnessId: settings.harnessId,
      model: settings.model,
      permissionMode: settings.permissionMode,
      effort: settings.effort,
      busy: canvasState.busy,
      setHarness: (harnessId) => canvasState.configureBoard({ harnessId }),
      setModel: (model) => canvasState.configureBoard({ model }),
      setPermissionMode: (permissionMode) => canvasState.configureBoard({ permissionMode }),
      setEffort: (effort) => canvasState.configureBoard({ effort }),
      start: async (text) => {
        const sessionId = await canvasState.startChat(text);
        if (sessionId) showSession(sessionId);
      },
      // A workflow picked here makes an asset; with no point given, its target
      // places the result on the board on screen.
      target: {
        cwd: canvasState.registry.cwd,
        boardDirectory: canvasState.registry.boardDirectory,
        sources: [],
        at: null,
      },
    };
  });

  /** How wide the drawer is, which decides whether the list sits beside the chat. */
  let paneWidth = $state(0);
  /**
   * Wide enough for the list and a chat side by side: the sidebar's 16rem plus
   * a chat at the drawer's default width. Dragging the drawer past it brings
   * the sidebar in, the way a chat app lays itself out on a large window.
   */
  const wide = $derived(paneWidth >= 720);
  /** The row the sidebar marks: the chat the user started, even while one of its agents is shown. */
  const selectedChatId = $derived(family[0]?.id ?? session?.sessionId ?? null);
</script>

{#snippet chatsHeading()}
  <span class="min-w-0 flex-1 truncate pl-2 text-sm font-semibold text-default">Chats</span>
  {#if runningCount > 0}
    <span class="flex items-center gap-1.5 text-2xs text-blue">
      <span class="size-1.5 animate-pulse rounded-full bg-blue"></span>
      {runningCount} running
    </span>
  {/if}
{/snippet}

<div class="flex h-full min-h-0" bind:clientWidth={paneWidth}>
  {#if wide}
    <aside class="flex w-64 shrink-0 flex-col border-r border-line">
      <header class="flex shrink-0 items-center gap-2 border-b border-line py-2 pr-2 pl-2">
        {@render chatsHeading()}
        <button
          type="button"
          class="rounded-md p-1 text-faint hover:bg-hover hover:text-default"
          aria-label="New chat"
          title="New chat"
          onclick={showOverview}
        >
          <NotePencilIcon size={14} />
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <ChatList
          groups={groupChats(chats, now)}
          {now}
          selectedId={listing ? null : selectedChatId}
          compact
          onOpen={openChat}
        />
      </div>
    </aside>
  {/if}

  <div class="flex min-w-0 flex-1 flex-col">
    <header class="flex shrink-0 items-center gap-2 border-b border-line py-2 pr-3 pl-2">
      {#if listing && !wide}
        {@render chatsHeading()}
      {:else if listing}
        <span class="min-w-0 flex-1 truncate pl-2 text-xs font-medium text-default">New chat</span>
      {:else if wide}
        <span class="min-w-0 flex-1 truncate pl-2 text-xs font-medium text-default">{title}</span>
      {:else}
        <button
          type="button"
          class="rounded-md p-1 text-faint hover:bg-hover hover:text-default"
          aria-label="All chats"
          title="All chats (← in an empty composer)"
          onclick={showOverview}
        >
          <ArrowLeftIcon size={14} />
        </button>
        <span class="min-w-0 flex-1 truncate text-xs font-medium text-default">{title}</span>
      {/if}

      {#if session}
        {@const label = statusLabel(session.status)}
        {#if label}
          <StatusBadge tone={statusTone(session.status)}>{label}</StatusBadge>
        {/if}
      {/if}

      <!-- What plugins offer on this conversation: the trajectory inspector lives here. -->
      <SlotHost slot="chat.actions" session={session ?? null} class="flex items-center gap-1" />
    </header>

    {#if listing && !wide}
      <!-- Every chat of this project; the composer under them starts another. -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <ChatList groups={groupChats(chats, now)} {now} onOpen={openChat} />
      </div>
      <div class="shrink-0">
        <Composer pending={newChat} />
      </div>
    {:else if listing}
      <!-- The list is in the sidebar, so the room beside it is the new chat's. -->
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
        <p class="text-lg font-medium text-default">What needs doing?</p>
        <p class="mt-1 text-xs text-dim">The agent works on this project's files.</p>
      </div>
      <div class="shrink-0">
        <Composer pending={newChat} />
      </div>
    {:else if pending}
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
        <Composer {pending} onSwitchAgent={switchAgent} />
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
        {workstream ? "This workstream is not loaded." : "This chat is not loaded."}
      </p>
    {/if}
  </div>
</div>
