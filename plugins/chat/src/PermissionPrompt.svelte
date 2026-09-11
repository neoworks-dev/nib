<script lang="ts">
  import type { PermissionBehavior, PermissionRequestView, SessionView } from "@nib-ui/protocol";
  import { kernelContext } from "@nib-ui/ui-contracts/svelte";
  import ToolPermissionCard from "./ToolPermissionCard.svelte";

  const { request, session }: { request: PermissionRequestView; session: SessionView } = $props();

  const context = kernelContext();
  const sessions = context.require("sessions");
  const renderers = context.require("renderers");

  // A plugin that claims the tool answers it inline; everything else gets allow/deny.
  const Interactive = $derived(renderers.resolvePermission(request.toolName));

  function respond(behavior: PermissionBehavior, updatedInput?: unknown) {
    // The transport scopes a response to the active task, so answering a chat
    // mounted on another session focuses that session first.
    if (sessions.activeId !== session.sessionId) sessions.open(session.sessionId);
    void sessions.respondToPermission(request.requestId, behavior, updatedInput);
  }
</script>

<div class="mx-6 mb-4">
  {#if Interactive}
    <Interactive {request} {session} {respond} />
  {:else}
    <ToolPermissionCard {request} {session} {respond} />
  {/if}
</div>
