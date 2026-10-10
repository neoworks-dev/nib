<script lang="ts">
  import {
    parseAgentNotification,
    type MessageItem,
    type SessionView,
    type TranscriptTurn,
    type UserItem,
  } from "@nib-ui/protocol";
  import { SlotHost } from "@nib-ui/ui-contracts/svelte";
  import AgentNotificationCard from "./AgentNotificationCard.svelte";
  import ItemHost from "./ItemHost.svelte";
  import CheckIcon from "phosphor-svelte/lib/CheckIcon";
  import GitBranchIcon from "phosphor-svelte/lib/GitBranchIcon";
  import CopyIcon from "phosphor-svelte/lib/CopyIcon";
  import ToolGroup from "./ToolGroup.svelte";
  import ToolSummary from "./ToolSummary.svelte";
  import { collapseToolRuns, groupTurnItems } from "./tool-groups";

  const {
    turn,
    session,
    onBranch,
  }: { turn: TranscriptTurn; session: SessionView; onBranch?: () => void } = $props();

  // A spawned agent's report enters the harness as a prompt, since nothing else
  // can; nobody typed it, so it is drawn as the report it is.
  const notification = $derived(
    turn.type === "user" ? parseAgentNotification(turn.item.text.trim()) : null,
  );
  const entries = $derived.by(() => {
    if (turn.type === "user") return [];
    const grouped = groupTurnItems(turn.items);
    // Tool work is shown while it runs and folded away once the turn is over.
    if (turn.completed) return collapseToolRuns(grouped);
    return grouped;
  });

  /** What the agent said in this turn, without the tool work between. */
  const replyText = $derived.by(() => {
    if (turn.type === "user") return "";
    const paragraphs: string[] = [];
    for (const item of turn.items) {
      if (item.type === "text") paragraphs.push(item.text.trim());
    }
    return paragraphs.join("\n\n");
  });

  let copied = $state(false);

  /** Copies the reply and shows a tick for a moment. */
  async function copyReply(): Promise<void> {
    await navigator.clipboard.writeText(replyText);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  /** The prompt as a message, so the same renderer that draws the agent's prose draws it. */
  function promptAsMessage(prompt: UserItem): MessageItem {
    return {
      type: "text",
      id: prompt.id,
      seq: prompt.seq,
      messageId: null,
      text: prompt.text,
      streaming: false,
      parentToolCallId: null,
    };
  }
</script>

{#if turn.type === "user"}
  {#if notification}
    <AgentNotificationCard {notification} {session} />
  {:else}
    <!-- The person's own words sit apart from the page the agent writes: a soft pill, right-aligned. -->
    <article
      data-message={turn.id}
      class="ml-auto flex max-w-[85%] flex-col gap-2 rounded-2xl bg-raised px-4 py-2.5"
    >
      <ItemHost item={promptAsMessage(turn.item)} {session} />
    </article>
  {/if}
{:else}
  <!-- The agent's turn is the page, not a card: items flow at the full column width. -->
  <article data-message={turn.id} class="flex flex-col gap-3">
    {#each entries as entry (entry.kind === "group" ? entry.group.id : entry.kind === "summary" ? entry.summary.id : entry.item.id)}
      {#if entry.kind === "summary"}
        <ToolSummary summary={entry.summary} {session} />
      {:else if entry.kind === "group"}
        <ToolGroup group={entry.group} {session} />
      {:else}
        <ItemHost item={entry.item} {session} />
      {/if}
    {/each}

    {#if !turn.completed}
      <span class="flex items-center gap-2 text-2xs text-faint">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-blue"></span>
        working
      </span>
    {:else if turn.stopReason && turn.stopReason !== "end_turn"}
      <span class="text-2xs text-amber">{turn.stopReason}</span>
    {/if}

    <SlotHost slot="message.footer" {session} {turn} class="flex flex-col gap-2" />
    {#if turn.completed && replyText.length > 0}
      <div class="flex items-center gap-1 text-faint">
        <button
          type="button"
          class="rounded-md p-1.5 hover:bg-hover hover:text-default"
          aria-label="Copy the reply"
          title="Copy"
          onclick={copyReply}
        >
          {#if copied}
            <CheckIcon size={16} />
          {:else}
            <CopyIcon size={16} />
          {/if}
        </button>
        {#if onBranch}
          <button
            type="button"
            class="rounded-md p-1.5 hover:bg-hover hover:text-default"
            aria-label="Branch in new chat"
            title="Branch in new chat"
            onclick={onBranch}
          >
            <GitBranchIcon size={16} />
          </button>
        {/if}
        <SlotHost slot="message.actions" {session} {turn} class="flex items-center gap-2" />
      </div>
    {:else}
      <SlotHost slot="message.actions" {session} {turn} class="flex items-center gap-2" />
    {/if}
  </article>
{/if}
