<script lang="ts">
	const { patch }: { patch: string } = $props();

	const lines = $derived(patch.split('\n'));

	function tone(line: string): string {
		if (line.startsWith('+++') || line.startsWith('---')) return 'text-faint';
		if (line.startsWith('@@')) return 'text-blue';
		if (line.startsWith('+')) return 'bg-green-soft text-green';
		if (line.startsWith('-')) return 'bg-red-soft text-red';
		if (line.startsWith('diff ') || line.startsWith('index ')) return 'text-faint';
		return 'text-muted';
	}
</script>

<div class="border-t border-line font-mono text-2xs">
	{#each lines as line, index (index)}
		<div class="px-3 py-px whitespace-pre-wrap {tone(line)}">{line || ' '}</div>
	{/each}
</div>
