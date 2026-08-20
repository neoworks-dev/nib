<script lang="ts">
	import type { PermissionBehavior, PermissionRequestView, SessionView } from '@nib-ui/protocol';
	import { clientContext } from '../context';
	import ToolPermissionCard from './ToolPermissionCard.svelte';

	const { request, session }: { request: PermissionRequestView; session: SessionView } = $props();

	const sessions = clientContext().require('sessions');
	const renderers = clientContext().require('renderers');

	// A plugin that claims the tool answers it inline; everything else gets allow/deny.
	const Interactive = $derived(renderers.resolvePermission(request.toolName));

	function respond(behavior: PermissionBehavior, updatedInput?: unknown) {
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
