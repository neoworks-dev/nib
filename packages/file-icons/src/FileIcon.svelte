<script lang="ts">
	import { fileIconName } from './icon-name';
	import { fileIcons } from './icons';

	const { path, size = 14 }: { path: string; size?: number } = $props();

	const markup = $derived(fileIcons[fileIconName(path)] ?? fileIcons.file!);
</script>

<!-- The pack ships plain SVG documents; sizing happens on the wrapper. -->
<span class="inline-flex shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full" style="width: {size}px; height: {size}px">
	{@html markup}
</span>
