<script lang="ts">
  import { Button } from "@neoworks-dev/ui";
  import type { MessageAttachment, SessionView } from "@nib-ui/protocol";
  import {
    assetUrl,
    effortLabel,
    fuzzyRank,
    permissionModeLabel,
    type SessionSummary,
  } from "@nib-ui/ui-contracts";
  import { harnessIcon, kernelContext, PillSelect, SlotHost } from "@nib-ui/ui-contracts/svelte";
  import BrainIcon from "phosphor-svelte/lib/BrainIcon";
  import PaperPlaneRightIcon from "phosphor-svelte/lib/PaperPlaneRightIcon";
  import ShieldCheckIcon from "phosphor-svelte/lib/ShieldCheckIcon";
  import StopCircleIcon from "phosphor-svelte/lib/StopCircleIcon";
  import AgentTabs from "./AgentTabs.svelte";
  import { composeAnnotatedMessage, type StagedAnnotation } from "./annotations";
  import { applyTrigger, detectTrigger, type TriggerItem } from "./composer-trigger";
  import { composerDrafts } from "./drafts.svelte";
  import HarnessSwitchDialog from "./HarnessSwitchDialog.svelte";
  import {
    describeHarnessSwitch,
    type HarnessSwitchPlan,
    planHarnessSwitch,
  } from "./harness-switch";
  import type { PendingComposer } from "./pending";
  import TriggerPopup from "./TriggerPopup.svelte";

  const {
    session,
    pending,
    annotations = [],
    attachments = [],
    onAnnotationsSent,
    onAttachmentsSent,
    agents = [],
    onSelectAgent,
    onSwitchAgent,
  }: {
    session?: SessionView;
    /**
     * A workstream that has not been launched. The controls are the same ones a
     * running session gets; what a pick does is the only difference, so the
     * markup below reads one target rather than branching on which it is.
     */
    pending?: PendingComposer;
    /** Highlighted passages the surface staged; they lead the outgoing prompt. */
    annotations?: StagedAnnotation[];
    /**
     * Files the surface has waiting for this task — what the board linked to it.
     * They ride the next prompt, and `onAttachmentsSent` says they have gone.
     */
    attachments?: MessageAttachment[];
    onAnnotationsSent?: () => void;
    onAttachmentsSent?: () => void;
    /**
     * The family this session belongs to, parents before the agents they started.
     * With more than one member the tabs sit on top of the input: the composer is
     * where the person addresses an agent, so that is where they pick which.
     */
    agents?: SessionSummary[];
    onSelectAgent?: (sessionId: string) => void;
    /** Steps to the agent before or after this one; the composer holds the keyboard. */
    onSwitchAgent?: (direction: -1 | 1) => void;
  } = $props();

  const context = kernelContext();
  const sessions = context.require("sessions");

  /** Keyed by session, or by the workstream while there is no session to key by. */
  const draftKey = $derived(session?.sessionId ?? pending?.id ?? "");
  /** Kept per session outside the component, so a file dropped on a task lands here. */
  const draft = $derived(composerDrafts.get(draftKey));
  let caret = $state(0);
  let dismissed = $state(false);
  let activeIndex = $state(0);
  let fileMatches = $state<string[]>([]);
  let textarea = $state<HTMLTextAreaElement>();
  /** A chosen harness waits here until the user accepts what the switch costs. */
  let proposed = $state<HarnessSwitchPlan | null>(null);
  let switching = $state(false);

  const capabilities = $derived(session?.capabilities);
  const busy = $derived(session?.status === "working");
  const canInterrupt = $derived(capabilities?.interrupt !== false && busy);
  const harnessId = $derived(session?.harnessId ?? pending?.harnessId ?? null);
  const harness = $derived(sessions.harnesses.find((entry) => entry.id === harnessId));
  // The model belongs to the harness driving the session, so the pill wears its mark.
  const HarnessIcon = $derived(harnessIcon(harnessId ?? ""));
  // Pre-flight: the harness descriptor answers before the session's own metadata
  // does, which is also all there is to go on before the session exists.
  const permissionModes = $derived(
    capabilities?.permissionModes ?? harness?.capabilities.permissionModes ?? [],
  );
  const models = $derived(
    session && session.models.length > 0 ? session.models : (harness?.models ?? []),
  );
  const effortLevels = $derived(
    capabilities?.effortLevels ?? harness?.capabilities.effortLevels ?? [],
  );
  const selectedModel = $derived(session?.model ?? pending?.model ?? null);
  const selectedPermissionMode = $derived(
    session?.permissionMode ?? pending?.permissionMode ?? null,
  );
  const selectedEffort = $derived(session?.effort ?? pending?.effort ?? null);

  const trigger = $derived(dismissed ? null : detectTrigger(draft, caret));
  const slashItems = $derived.by((): TriggerItem[] => {
    if (trigger?.kind !== "slash" || !session) return [];
    return fuzzyRank(session.slashCommands, trigger.query, (command) => command.name, 12).map(
      ({ item }) => ({
        value: item.name,
        label: `/${item.name}`,
        hint: item.argumentHint || item.description,
      }),
    );
  });
  const fileItems = $derived(
    trigger?.kind === "file" ? fileMatches.map((path) => ({ value: path, label: path })) : [],
  );
  const items = $derived(trigger?.kind === "slash" ? slashItems : fileItems);
  const heading = $derived(trigger?.kind === "slash" ? "Slash commands" : "Workspace files");
  const confirmation = $derived(
    proposed ? describeHarnessSwitch(proposed, harnessName(proposed.toHarnessId)) : null,
  );

  $effect(() => {
    if (trigger?.kind !== "file") {
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

  /**
   * Everything but `sendTo` is scoped to the active task by the transport, so a
   * chat mounted on another session — a second chat pane — focuses it first.
   */
  function focusSession() {
    if (session && sessions.activeId !== session.sessionId) sessions.open(session.sessionId);
  }

  async function submit() {
    const text = composeAnnotatedMessage(annotations, draft);
    if (text.length === 0 && attachments.length === 0) return;
    composerDrafts.set(draftKey, "");
    caret = 0;
    // Without a session the first prompt is what creates one; the pending target
    // carries the picks the pills made, and the files, into the session it starts.
    if (!session) {
      await pending?.start(text);
      return;
    }
    await sessions.sendTo(session.sessionId, text, attachments);
    onAnnotationsSent?.();
    if (attachments.length > 0) onAttachmentsSent?.();
  }

  function harnessName(id: string): string {
    return sessions.harnesses.find((entry) => entry.id === id)?.displayName ?? id;
  }

  /** The pick means different things before and after there is a transcript to move. */
  function harnessHint(id: string): string {
    if (!session)
      return id === harnessId ? "Starts this workstream" : "Starts this workstream instead";
    return id === session.harnessId
      ? "Running this conversation"
      : "Replays this conversation as text";
  }

  /**
   * Nothing happens on the pick itself: replaying a conversation into another
   * harness is paid for in tokens, so the switch waits for an explicit yes. A
   * workstream with no transcript has nothing to replay, so its pick just lands.
   */
  function proposeHarness(picked: string) {
    if (!session) return pending?.setHarness(picked);
    proposed = planHarnessSwitch(session, picked);
  }

  /**
   * The old session is left alone — it keeps its transcript and stays in the task
   * list. What continues the work is a new session in the same directory whose
   * first prompt is the old transcript, and the board follows it through the event.
   */
  async function confirmSwitch() {
    const plan = proposed;
    if (!plan || switching) return;
    switching = true;
    try {
      const before = sessions.activeId;
      await sessions.create({ harnessId: plan.toHarnessId, cwd: plan.cwd });
      const created = sessions.activeId;
      // `create` reports a refusal through the service's own error, not by throwing.
      if (!created || created === before) return;
      sessions.watch(created);
      await sessions.sendTo(created, plan.seed);
      context.emit("session/replaced", plan.fromSessionId, created);
    } finally {
      switching = false;
      proposed = null;
    }
  }

  /** Text and caret are read off the event together: a stale pair kills the triggers. */
  function onInput(event: Event & { currentTarget: HTMLTextAreaElement }) {
    dismissed = false;
    composerDrafts.set(draftKey, event.currentTarget.value);
    caret = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
  }

  function syncCaret() {
    caret = textarea?.selectionStart ?? draft.length;
  }

  function pick(item: TriggerItem) {
    if (!trigger) return;
    const applied = applyTrigger(draft, trigger, item.value);
    composerDrafts.set(draftKey, applied.text);
    caret = applied.caret;
    dismissed = true;
    textarea?.focus();
    queueMicrotask(() => textarea?.setSelectionRange(applied.caret, applied.caret));
  }

  function onKeydown(event: KeyboardEvent) {
    if (switchAgent(event)) return;
    if (items.length > 0 && navigatePopup(event)) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void submit();
  }

  /**
   * An empty draft has no caret to move, so the arrows step between the agents
   * of a family; with text in it they stay the caret keys they are unless Alt
   * says otherwise. An open trigger popup owns the keyboard either way.
   */
  function switchAgent(event: KeyboardEvent): boolean {
    if (!onSwitchAgent || items.length > 0) return false;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
    if (draft.length > 0 && !event.altKey) return false;
    event.preventDefault();
    onSwitchAgent(event.key === "ArrowLeft" ? -1 : 1);
    return true;
  }

  function navigatePopup(event: KeyboardEvent): boolean {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = activeIndex + (event.key === "ArrowDown" ? 1 : -1);
      activeIndex = Math.max(0, Math.min(next, items.length - 1));
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(items[activeIndex] ?? items[0]!);
      return true;
    }
    if (event.key === "Escape") {
      dismissed = true;
      return true;
    }
    return false;
  }
</script>

<div class="px-8 pb-5">
  <div
    class="relative flex flex-col rounded-2xl border border-line bg-raised focus-within:border-line-strong"
  >
    {#if trigger && items.length > 0}
      <TriggerPopup {items} {activeIndex} {heading} files={trigger.kind === "file"} onpick={pick} />
    {/if}

    {#if session && agents.length > 1}
      <!-- The box's own top edge: the first tab starts in its corner, clipped to the rounding. -->
      <div class="overflow-hidden rounded-t-2xl border-b border-line-faint">
        <AgentTabs
          family={agents}
          activeSessionId={session.sessionId}
          onSelect={(sessionId) => onSelectAgent?.(sessionId)}
        />
      </div>
    {/if}

    <div class="flex flex-col gap-2 px-3 py-2">
      <!-- What rides the next prompt, shown before it goes: a picture as itself, anything else by name. -->
      {#if attachments.length > 0}
        <div class="flex flex-wrap items-center gap-2 px-1 pt-1">
          {#each attachments as attachment (attachment.assetId)}
            {#if attachment.mime.startsWith("image/")}
              <img
                src={assetUrl(attachment.assetId)}
                alt={attachment.name}
                title={attachment.name}
                class="h-20 max-w-40 rounded-lg border border-line object-cover"
              />
            {:else}
              <span
                class="max-w-52 truncate rounded-full border border-line bg-raised px-2 py-0.5 text-2xs text-muted"
                title={attachment.name}
              >
                {attachment.name}
              </span>
            {/if}
          {/each}
        </div>
      {/if}

      <textarea
        bind:this={textarea}
        value={draft}
        oninput={onInput}
        onkeyup={syncCaret}
        onclick={syncCaret}
        onkeydown={onKeydown}
        rows="2"
        placeholder={session
          ? "Ask for follow-up changes — / for commands, @ for files"
          : "What needs doing? — @ for files"}
        class="min-h-14 w-full resize-none bg-transparent px-1 py-1 text-base text-default placeholder:text-faint focus:outline-none"
      ></textarea>

      <div class="flex flex-wrap items-center gap-2">
        {#if permissionModes.length > 0}
          <PillSelect
            icon={ShieldCheckIcon}
            value={selectedPermissionMode}
            placeholder="Permission"
            options={permissionModes.map((mode) => ({
              value: mode,
              label: permissionModeLabel(mode),
              hint: mode,
            }))}
            onChange={(mode) => {
              if (!session) return pending?.setPermissionMode(mode);
              focusSession();
              void sessions.setPermissionMode(mode);
            }}
          />
        {/if}

        {#if models.length > 0}
          <PillSelect
            value={selectedModel}
            placeholder="Model"
            options={models.map((model) => ({
              value: model.id,
              label: model.displayName ?? model.id,
              hint: model.description,
            }))}
            onChange={(model) => {
              if (!session) return pending?.setModel(model);
              focusSession();
              void sessions.setModel(model);
            }}
          />
        {/if}

        {#if effortLevels.length > 0}
          <PillSelect
            icon={BrainIcon}
            value={selectedEffort}
            placeholder="Effort"
            options={effortLevels.map((level) => ({ value: level, label: effortLabel(level) }))}
            onChange={(effort) => {
              if (!session) return pending?.setEffort(effort);
              focusSession();
              void sessions.setEffort(effort);
            }}
          />
        {/if}

        {#if sessions.harnesses.length > 1}
          <PillSelect
            icon={HarnessIcon}
            value={harnessId}
            placeholder="Harness"
            options={sessions.harnesses.map((entry) => ({
              value: entry.id,
              label: entry.displayName,
              icon: harnessIcon(entry.id),
              hint: harnessHint(entry.id),
            }))}
            onChange={proposeHarness}
          />
        {/if}

        <SlotHost
          slot="composer.actions"
          session={session ?? null}
          class="flex items-center gap-2"
        />

        <span class="ml-auto">
          {#if canInterrupt}
            <span class="animate-pulse">
              <Button
                size="sm"
                variant="danger"
                icon={StopCircleIcon}
                onclick={() => {
                  focusSession();
                  void sessions.interrupt();
                }}
              >
                Interrupt
              </Button>
            </span>
          {:else}
            <Button
              size="sm"
              variant="primary"
              icon={PaperPlaneRightIcon}
              disabled={(draft.trim().length === 0 &&
                annotations.length === 0 &&
                attachments.length === 0) ||
                pending?.busy === true}
              onclick={submit}>Send</Button
            >
          {/if}
        </span>
      </div>
    </div>
  </div>
</div>

{#if confirmation}
  <HarnessSwitchDialog
    {confirmation}
    busy={switching}
    onConfirm={confirmSwitch}
    onCancel={() => (proposed = null)}
  />
{/if}
