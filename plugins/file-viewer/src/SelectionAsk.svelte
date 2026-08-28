<script lang="ts">
	import PaperPlaneRightIcon from 'phosphor-svelte/lib/PaperPlaneRightIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { describeRange, type Selection } from './ask';

	const {
		selection,
		onsubmit,
		oncancel,
	}: {
		selection: Selection;
		onsubmit: (request: string) => void;
		oncancel: () => void;
	} = $props();

	let request = $state('');

	function submit() {
		if (request.trim().length === 0) return;
		onsubmit(request);
		request = '';
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') return oncancel();
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		submit();
	}
</script>

<!-- A press inside this prompt would otherwise start a new selection behind it. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex items-center gap-2 border-y border-line bg-elevated px-3 py-1.5 font-sans text-xs select-text"
	onmousedown={(event) => event.stopPropagation()}
>
	<span class="shrink-0 text-2xs text-faint">{describeRange(selection)}</span>
	<!-- svelte-ignore a11y_autofocus -->
	<input
		bind:value={request}
		autofocus
		onkeydown={onKeydown}
		placeholder="Ask the agent about these lines"
		class="min-w-0 flex-1 bg-transparent text-default placeholder:text-faint focus:outline-none"
	/>
	<button
		type="button"
		class="shrink-0 rounded-md p-1 text-faint hover:text-default disabled:opacity-40"
		aria-label="Send the question"
		disabled={request.trim().length === 0}
		onclick={submit}
	>
		<PaperPlaneRightIcon size={12} />
	</button>
	<button
		type="button"
		class="shrink-0 rounded-md p-1 text-faint hover:text-default"
		aria-label="Dismiss"
		onclick={oncancel}
	>
		<XIcon size={12} />
	</button>
</div>
