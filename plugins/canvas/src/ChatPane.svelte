<script lang="ts">
  import { StatusBadge } from "@neoworks-dev/ui";
  import {
    agentFamily,
    ChatSurface,
    Composer,
    composerDrafts,
    type PendingComposer,
  } from "@nib-ui/plugin-chat";
  import { type PaneProps, statusLabel, statusTone } from "@nib-ui/ui-contracts";
  import { SlotHost } from "@nib-ui/ui-contracts/svelte";
  import ArrowLeftIcon from "phosphor-svelte/lib/ArrowLeftIcon";
  import CubeIcon from "phosphor-svelte/lib/CubeIcon";
  import ImageIcon from "phosphor-svelte/lib/ImageIcon";
  import ListChecksIcon from "phosphor-svelte/lib/ListChecksIcon";
  import MagnifyingGlassIcon from "phosphor-svelte/lib/MagnifyingGlassIcon";
  import NotePencilIcon from "phosphor-svelte/lib/NotePencilIcon";
  import { untrack } from "svelte";
  import { chatList, filterChats, groupChats } from "./chat-list";
  import ChatList from "./ChatList.svelte";
  import { chatSeen } from "./chat-seen.svelte";
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

  /** Pins a chat above the rest of the list, or lets it go back to where its age puts it. */
  function pinChat(sessionId: string, pinned: boolean): void {
    void canvasState.sessions?.setPinned(sessionId, pinned);
  }

  /** Renames a chat; the label rides its own log, so it is watched for the name to land. */
  async function renameChat(sessionId: string, label: string): Promise<void> {
    const sessions = canvasState.sessions;
    if (!sessions) return;
    sessions.watch(sessionId);
    await sessions.rename(sessionId, label);
    await sessions.refresh();
  }

  /** Deletes a chat and its transcript; if it was the one on screen, the pane goes back to the overview. */
  async function deleteChat(sessionId: string): Promise<void> {
    const sessions = canvasState.sessions;
    if (!sessions) return;
    const wasOpen = sessionId === selectedChatId;
    await sessions.remove(sessionId);
    // The service keeps a refusal in `error` and returns; without this the row would just stay.
    if (sessions.error) {
      canvasState.reportError(`Could not delete the chat: ${sessions.error}`);
      return;
    }
    if (wasOpen) showOverview();
  }

  /** Forks a chat into a new one and opens it. */
  async function branchChat(sessionId: string): Promise<void> {
    const branchedId = await canvasState.branchChat(sessionId);
    if (branchedId) openChat(branchedId);
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
  /** Re-read each minute so the ages on the overview do not go stale. */
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  /** What the sidebar's search field has narrowed the overview to. */
  let query = $state("");
  const visibleGroups = $derived(groupChats(filterChats(chats, query), now));
  const unreadIds = $derived(chatSeen.unreadIds(chats));

  // Chats the user has not looked at yet start out read; the open one stays read
  // while it keeps moving, so only what finishes out of sight is marked.
  $effect(() => {
    untrack(() => chatSeen.seed(chats));
  });
  $effect(() => {
    const open = chats.find((chat) => chat.sessionId === selectedChatId);
    if (open && !listing) untrack(() => chatSeen.markSeen(open));
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
      start: (text, attachments) => canvasState.launch(card.id, text, "compact", attachments),
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
      start: async (text, attachments) => {
        const sessionId = await canvasState.startChat(text, attachments);
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
  /** Whether the chat on screen can be forked, which decides if its replies offer it. */
  const branchable = $derived(
    chats.find((chat) => chat.sessionId === selectedChatId)?.branchable === true,
  );

  /** What nib is used for, as starting points: each one opens a sentence in the composer. */
  const quickStarts = [
    { label: "3D model", icon: CubeIcon, prompt: "Make a 3D model of " },
    { label: "Image", icon: ImageIcon, prompt: "Generate an image of " },
    { label: "Plan work", icon: ListChecksIcon, prompt: "Plan the work for " },
  ];

  /** Puts a quick start's opening words in the new chat's composer for the user to finish. */
  function startFrom(prompt: string): void {
    composerDrafts.set(newChat.id, prompt);
  }
</script>

{#snippet chatTools()}
  <!-- Starting a chat and finding one: the top of the overview, beside or above it. -->
  <div class="flex shrink-0 flex-col gap-1.5 p-2">
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-default hover:bg-hover"
      class:bg-raised={listing}
      onclick={showOverview}
    >
      <NotePencilIcon size={16} />
      New chat
    </button>
    <label
      class="flex items-center gap-2 rounded-lg border border-line-faint px-2 py-1.5 text-sm text-dim focus-within:border-line"
    >
      <MagnifyingGlassIcon size={14} />
      <input
        type="search"
        class="min-w-0 flex-1 bg-transparent text-default outline-none placeholder:text-faint"
        placeholder="Search chats"
        aria-label="Search chats"
        bind:value={query}
      />
    </label>
  </div>
{/snippet}

<div class="flex h-full min-h-0" bind:clientWidth={paneWidth}>
  {#if wide}
    <aside class="flex w-64 shrink-0 flex-col border-r border-line">
      {@render chatTools()}
      <div class="min-h-0 flex-1 overflow-y-auto">
        <ChatList
          groups={visibleGroups}
          {now}
          {unreadIds}
          selectedId={listing ? null : selectedChatId}
          compact
          onOpen={openChat}
          onPin={pinChat}
          onRename={renameChat}
          onDelete={deleteChat}
        />
      </div>
    </aside>
  {/if}

  <div class="flex min-w-0 flex-1 flex-col">
    {#if !listing}
      <header class="flex shrink-0 items-center gap-2 border-b border-line py-2 pr-3 pl-2">
        {#if wide}
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
    {/if}

    {#if listing && !wide}
      <!-- Every chat of this project; the composer under them starts another. -->
      {@render chatTools()}
      <div class="min-h-0 flex-1 overflow-y-auto">
        <ChatList
          groups={visibleGroups}
          {now}
          {unreadIds}
          onOpen={openChat}
          onPin={pinChat}
          onRename={renameChat}
          onDelete={deleteChat}
        />
      </div>
      <div class="shrink-0">
        <Composer pending={newChat} />
      </div>
    {:else if listing}
      <!-- The list is in the sidebar, so the room beside it is the new chat's. -->
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
        <p class="text-lg font-medium text-default">What needs doing?</p>
        <p class="mt-1 text-xs text-dim">The agent works on this project's files.</p>
        <div class="mt-4 flex flex-wrap justify-center gap-2">
          {#each quickStarts as quickStart (quickStart.label)}
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:bg-hover hover:text-default"
              onclick={() => startFrom(quickStart.prompt)}
            >
              <quickStart.icon size={14} />
              {quickStart.label}
            </button>
          {/each}
        </div>
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
          onBranch={branchable ? () => branchChat(selectedChatId ?? "") : undefined}
        />
      </div>
    {:else}
      <p class="min-h-0 flex-1 px-3 py-3 text-xs text-dim">
        {workstream ? "This workstream is not loaded." : "This chat is not loaded."}
      </p>
    {/if}
  </div>
</div>
