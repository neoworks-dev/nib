<script lang="ts">
	import { Button, Card } from '@neoworks-dev/ui';
	import ShieldWarningIcon from 'phosphor-svelte/lib/ShieldWarningIcon';
	import { permissionPreviewBlock } from '@nib-ui/protocol';
	import type { PermissionRendererProps } from '@nib-ui/ui-contracts';
	import BlockHost from './BlockHost.svelte';

	const { request, session, respond }: PermissionRendererProps = $props();

	// The pending call is previewed by the same renderers that draw it once it runs.
	const preview = $derived(permissionPreviewBlock(request));
</script>

<Card surface="raised" padding="md" class="border border-amber">
	<div class="flex flex-col gap-3">
		<header class="flex items-center gap-2">
			<span class="text-amber"><ShieldWarningIcon size={16} /></span>
			<span class="text-2xs tracking-caps uppercase text-amber">Permission</span>
			<span class="font-mono text-xs text-default">{request.toolName}</span>
		</header>

		<BlockHost block={preview} {session} />

		<footer class="flex gap-2">
			<Button onclick={() => respond('allow')}>Allow</Button>
			<Button variant="ghost" onclick={() => respond('deny')}>Deny</Button>
		</footer>
	</div>
</Card>
