<script lang="ts">
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
	import { blockToolInput } from '@nib-ui/protocol';
	import type { RendererProps } from '@nib-ui/ui-contracts';
	import BlockShell from './BlockShell.svelte';

	const { block }: RendererProps = $props();

	const input = $derived(blockToolInput(block));
	const serialized = $derived(typeof input === 'string' ? input : JSON.stringify(input, null, 2));
</script>

<BlockShell
	icon={block.completed ? WrenchIcon : CircleNotchIcon}
	title={block.toolName ?? 'tool'}
	tone={block.completed ? 'blue' : 'amber'}
	status={block.completed ? undefined : 'streaming'}
>
	<pre class="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-muted">{serialized ?? ''}</pre>
</BlockShell>
