<script lang="ts">
	import { Button, Card } from '@neoworks-dev/ui';
	import type { PermissionRequestView } from '@nib-ui/protocol';
	import { clientContext } from '../context';

	const { request }: { request: PermissionRequestView } = $props();

	const sessions = clientContext().require('sessions');
</script>

<Card surface="raised" padding="md" class="mx-6 mb-4 border border-amber">
	<div class="flex flex-col gap-3">
		<div class="flex items-center gap-2 text-sm">
			<span class="tracking-caps uppercase text-amber">Permission</span>
			<span class="font-mono text-default">{request.toolName}</span>
		</div>
		<pre class="max-h-48 overflow-auto rounded-md bg-input p-3 font-mono text-xs text-muted">{JSON.stringify(
				request.input,
				null,
				2,
			)}</pre>
		<div class="flex gap-2">
			<Button onclick={() => sessions.respondToPermission(request.requestId, 'allow')}>Allow</Button>
			<Button variant="ghost" onclick={() => sessions.respondToPermission(request.requestId, 'deny')}>Deny</Button>
		</div>
	</div>
</Card>
