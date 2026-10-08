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
  import ToolGroup from "./ToolGroup.svelte";
  import { groupTurnItems } from "./tool-groups";

  const { turn, session }: { turn: TranscriptTurn; session: SessionView } = $props();

  // A spawned agent's report enters the harness as a prompt, since nothing else
  // can; nobody typed it, so it is drawn as the report it is.
  const notification = $derived(
    turn.type === "user" ? parseAgentNotification(turn.item.text.trim()) : null,
  );
  const entries = $derived.by(() => {
    if (turn.type === "user") return [];
    return groupTurnItems(turn.items);
  });

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
    <article
      data-message={turn.id}
      class="flex flex-col gap-2 rounded-xl border border-line-faint bg-raised px-4 py-3"
    >
      <ItemHost item={promptAsMessage(turn.item)} {session} />
    </article>
  {/if}
{:else}
  <!-- The agent's turn is the page, not a card: items flow at the full column width. -->
  <article data-message={turn.id} class="flex flex-col gap-3">
    {#each entries as entry (entry.kind === "group" ? entry.group.id : entry.item.id)}
      {#if entry.kind === "group"}
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
    <SlotHost slot="message.actions" {session} {turn} class="flex items-center gap-2" />
  </article>
{/if}
