<script lang="ts">
  import { Card, type StatusTone } from "@neoworks-dev/ui";
  import type { AgentNotification, SessionView } from "@nib-ui/protocol";
  import { showAgentSession, statusLabel, statusTone } from "@nib-ui/ui-contracts";
  import { harnessIcon, kernelContext } from "@nib-ui/ui-contracts/svelte";

  const { notification, session }: { notification: AgentNotification; session: SessionView } =
    $props();

  const context = kernelContext();
  const sessions = context.require("sessions");
  const panes = context.require("panes");

  const Icon = $derived(harnessIcon(notification.harness));
  const harnessName = $derived.by(() => {
    const descriptor = sessions.harnesses.find((entry) => entry.id === notification.harness);
    return descriptor?.displayName ?? notification.harness;
  });
  // The notification says how the agent ended; the agent may have moved on since.
  const tone = $derived(statusTone(notification.status));
  const outcome = $derived.by(() => {
    if (notification.status === "error") return "failed";
    return "finished";
  });
  const stateWord = $derived(statusLabel(notification.status));
  const title = $derived.by(() => {
    if (notification.title) return notification.title;
    const summary = sessions.summaries.find((entry) => entry.id === notification.sessionId);
    if (summary?.title) return summary.title;
    return "Agent";
  });

  const toneClass: Record<StatusTone, string> = {
    neutral: "text-dim",
    green: "text-green",
    red: "text-red",
    amber: "text-amber",
    blue: "text-blue",
    violet: "text-violet",
  };

  let expanded = $state(false);

  function open(): void {
    showAgentSession(panes, sessions, session.sessionId, notification.sessionId);
  }
</script>

<Card surface="raised" padding="none" class="overflow-hidden">
  <header class="flex items-center gap-2 border-b border-line-faint px-3 py-1.5">
    <span class={toneClass[tone]}><Icon size={14} /></span>
    <span class="text-2xs tracking-caps uppercase text-dim">{harnessName} agent {outcome}</span>
    {#if stateWord}
      <span class="text-2xs {toneClass[tone]}">{stateWord}</span>
    {/if}
    <button
      type="button"
      class="ml-auto text-2xs text-muted hover:text-default"
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? "less" : "more"}
    </button>
  </header>
  <button
    type="button"
    class="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-hover"
    onclick={open}
  >
    <span class="truncate text-xs text-default">{title}</span>
    {#if notification.detail}
      <span class="text-2xs text-red">{notification.detail}</span>
    {/if}
    <span
      class="text-2xs leading-relaxed whitespace-pre-wrap text-dim"
      class:line-clamp-4={!expanded}
    >
      {notification.result}
    </span>
  </button>
</Card>
