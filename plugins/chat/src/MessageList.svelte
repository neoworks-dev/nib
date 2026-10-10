<script lang="ts">
  import { type SessionView, transcriptTurns } from "@nib-ui/protocol";
  import MessageTurn from "./MessageTurn.svelte";

  const { session, onBranch }: { session: SessionView; onBranch?: () => void } = $props();

  const turns = $derived(transcriptTurns(session));
</script>

<!-- A reading column, not the pane's full width: long lines are hard to follow. -->
<div class="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-6">
  {#each turns as turn, index (turn.id)}
    <!-- A branch carries the whole conversation, so only the newest reply offers one. -->
    <MessageTurn {turn} {session} onBranch={index === turns.length - 1 ? onBranch : undefined} />
  {/each}

  {#if turns.length === 0}
    <p class="text-sm text-dim">No messages yet. Send a prompt to start the turn.</p>
  {/if}
</div>
