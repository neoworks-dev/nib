<script lang="ts">
  import {
    type SessionSummary,
    statusLabel,
    statusTone,
    type StatusTone,
  } from "@nib-ui/ui-contracts";
  import { harnessIcon, kernelContext } from "@nib-ui/ui-contracts/svelte";

  const {
    family,
    activeSessionId,
    onSelect,
  }: {
    /** The sessions of one family, parents before the agents they started. */
    family: SessionSummary[];
    /** Which of them the chat is showing; the others are one click away. */
    activeSessionId: string;
    onSelect: (sessionId: string) => void;
  } = $props();

  const context = kernelContext();
  const sessions = context.require("sessions");

  // The list of sessions is re-read on a timer, so a sibling's status would sit
  // up to five seconds stale in its tab. A subscription is what makes it move.
  $effect(() => {
    for (const member of family) sessions.watch(member.id);
  });

  const toneClass: Record<StatusTone, string> = {
    neutral: "text-dim",
    green: "text-green",
    red: "text-red",
    amber: "text-amber",
    blue: "text-blue",
    violet: "text-violet",
  };

  /**
   * A bar along the top of the composer, flush with its corner: tabs are cells
   * of it rather than pills, so the open one is lifted by surface alone and the
   * rest are quiet until hovered.
   */
  function tabClass(sessionId: string): string {
    if (sessionId === activeSessionId) return "bg-elevated text-default";
    return "text-muted hover:bg-hover hover:text-default";
  }

  /** What the harness calls the model, once the session itself can say. */
  function modelLabel(member: SessionSummary): string | null {
    const view = sessions.view(member.id);
    const model = view?.model ?? member.model;
    if (!model) return null;
    const known = view?.models.find((entry) => entry.id === model);
    if (known?.displayName) return known.displayName;
    return model;
  }
</script>

<div class="flex min-w-0 items-stretch overflow-x-auto">
  {#each family as member (member.id)}
    {@const Icon = harnessIcon(member.harnessId)}
    {@const model = modelLabel(member)}
    {@const title = member.title ?? "Untitled"}
    <button
      type="button"
      class="flex max-w-52 min-w-0 shrink items-center gap-1.5 border-r border-line-faint px-3 py-1.5 text-xs {tabClass(
        member.id,
      )}"
      aria-current={member.id === activeSessionId}
      title={model ? `${title} — ${model}` : title}
      onclick={() => onSelect(member.id)}
    >
      <span class="shrink-0 text-dim"><Icon size={14} /></span>
      <span
        class="h-1.5 w-1.5 shrink-0 rounded-full bg-current {toneClass[statusTone(member.status)]}"
        title={statusLabel(member.status) ?? "Idle"}
      ></span>
      <span class="min-w-0 flex-1 truncate">{title}</span>
      {#if model}
        <span class="shrink-0 truncate text-2xs text-faint">{model}</span>
      {/if}
    </button>
  {/each}
</div>
