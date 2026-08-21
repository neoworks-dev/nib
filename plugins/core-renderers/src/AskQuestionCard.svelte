<script lang="ts">
	import { Button, Card } from '@neoworks-dev/ui';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import ChatCircleTextIcon from 'phosphor-svelte/lib/ChatCircleTextIcon';
	import { isAnswerComplete, parseAskUserQuestion, withQuestionAnswers } from '@nib-ui/protocol';
	import type { PermissionRendererProps } from '@nib-ui/ui-contracts';

	const { request, respond }: PermissionRendererProps = $props();

	let selections = $state<Record<string, string[]>>({});
	let freeform = $state<Record<string, string>>({});
	let page = $state(0);

	const parsed = $derived(parseAskUserQuestion(request.input));
	const questions = $derived(parsed?.questions ?? []);
	const question = $derived(questions[Math.min(page, questions.length - 1)]);
	const isLast = $derived(page >= questions.length - 1);
	const answered = $derived(question ? (selections[question.question]?.length ?? 0) > 0 : false);
	const complete = $derived(parsed !== null && isAnswerComplete(parsed, selections));

	function choose(label: string) {
		if (!question) return;
		const current = selections[question.question] ?? [];
		const picked = question.multiSelect
			? current.includes(label)
				? current.filter((entry) => entry !== label)
				: [...current, label]
			: [label];
		selections = { ...selections, [question.question]: picked };
		// A single-select pick is the whole answer, so it turns the page itself.
		if (!question.multiSelect) advance(selections);
	}

	function answerFreeform() {
		if (!question) return;
		const text = freeform[question.question]?.trim() ?? '';
		if (text.length === 0) return;
		const next = { ...selections, [question.question]: [text] };
		selections = next;
		advance(next);
	}

	function advance(answers: Record<string, string[]>) {
		if (!isLast) return void (page += 1);
		if (parsed && isAnswerComplete(parsed, answers)) respond('allow', withQuestionAnswers(parsed, answers));
	}

	function isPicked(label: string): boolean {
		return question ? (selections[question.question] ?? []).includes(label) : false;
	}
</script>

<Card surface="raised" padding="md" class="border border-violet">
	<div class="flex flex-col gap-4">
		<header class="flex items-center gap-2">
			<span class="text-violet"><ChatCircleTextIcon size={16} /></span>
			<span class="text-2xs tracking-caps uppercase text-violet">{question?.header ?? 'Question'}</span>
			{#if questions.length > 1}
				<span class="ml-auto text-2xs tabular-nums text-faint">{page + 1} / {questions.length}</span>
			{/if}
		</header>

		{#if question}
			<p class="text-sm text-default">{question.question}</p>

			<div class="grid gap-2 sm:grid-cols-2">
				{#each question.options as option (option.label)}
					<button
						type="button"
						class="flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors duration-fast {isPicked(
							option.label,
						)
							? 'border-violet bg-raised'
							: 'border-line hover:border-line-strong'}"
						onclick={() => choose(option.label)}
					>
						<span class="text-sm text-default">{option.label}</span>
						{#if option.description}
							<span class="text-xs text-dim">{option.description}</span>
						{/if}
						{#if option.preview}
							<pre
								class="mt-1 max-h-32 overflow-auto rounded-md bg-input p-2 font-mono text-2xs text-muted">{option.preview}</pre>
						{/if}
					</button>
				{/each}
			</div>

			<div class="flex items-center gap-2">
				<input
					bind:value={freeform[question.question]}
					onkeydown={(event) => {
						if (event.key === 'Enter') answerFreeform();
					}}
					placeholder="Other — type your own answer"
					class="min-w-0 flex-1 rounded-md border border-line bg-input px-3 py-1.5 text-sm text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
				/>
				<Button
					size="sm"
					variant="ghost"
					disabled={(freeform[question.question] ?? '').trim().length === 0}
					onclick={answerFreeform}>Use</Button
				>
			</div>
		{:else}
			<p class="text-xs text-dim">This question has no options the UI can render; allow or deny the raw call.</p>
		{/if}

		<footer class="flex items-center gap-2">
			{#if page > 0}
				<Button size="sm" variant="ghost" icon={ArrowLeftIcon} onclick={() => (page -= 1)}>Back</Button>
			{/if}
			{#if question?.multiSelect || !isLast}
				<Button size="sm" disabled={!answered} onclick={() => advance(selections)}>
					{isLast ? 'Submit answers' : 'Next'}
				</Button>
			{:else if questions.length > 1}
				<Button size="sm" disabled={!complete} onclick={() => advance(selections)}>Submit answers</Button>
			{/if}
			<Button size="sm" variant="ghost" onclick={() => respond('deny')}>Skip</Button>
		</footer>
	</div>
</Card>
