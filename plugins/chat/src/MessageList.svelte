<script lang="ts">
  import { type SessionView, transcriptTurns } from "@nib-ui/protocol";
  import MessageTurn from "./MessageTurn.svelte";

  const { session }: { session: SessionView } = $props();

  const turns = $derived(transcriptTurns(session));
</script>

<div class="flex w-full flex-col gap-5 px-8 py-6">
  {#each turns as turn (turn.id)}
    <MessageTurn {turn} {session} />
  {/each}

  {#if turns.length === 0}
    <p class="text-sm text-dim">No messages yet. Send a prompt to start the turn.</p>
  {/if}
</div>
