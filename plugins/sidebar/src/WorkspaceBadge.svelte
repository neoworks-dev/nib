<script lang="ts">
	import { workspaceIconUrl, workspaceInitials } from './workspace-badge';

	const { path, name, size = 18 }: { path: string; name: string; size?: number } = $props();

	let missing = $state(false);

	$effect(() => {
		path;
		missing = false;
	});
</script>

<span
	class="flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-raised text-muted"
	style="width: {size}px; height: {size}px"
>
	{#if missing}
		<span class="text-[9px] leading-none font-semibold tracking-tight">{workspaceInitials(name)}</span>
	{:else}
		<img
			src={workspaceIconUrl(path)}
			alt=""
			class="h-full w-full object-contain"
			loading="lazy"
			onerror={() => (missing = true)}
		/>
	{/if}
</span>
