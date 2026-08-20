<script lang="ts">
	import { Button, Card } from '@neoworks-dev/ui';
	import ChatCircleTextIcon from 'phosphor-svelte/lib/ChatCircleTextIcon';
	import { isAnswerComplete, parseAskUserQuestion, withQuestionAnswers } from '@nib-ui/protocol';
	import type { PermissionRendererProps } from '@nib-ui/ui-contracts';

	const { request, respond }: PermissionRendererProps = $props();

	let selections = $state<Record<string, string[]>>({});
	let freeform = $state<Record<string, string>>({});

	const parsed = $derived(parseAskUserQuestion(request.input));
	const questions = $derived(parsed?.questions ?? []);
	/** One single-select question resolves on the click itself; anything else needs a submit. */
	const singleShot = $derived(questions.length === 1 && questions[0]?.multiSelect !== true);
	const complete = $derived(parsed !== null && isAnswerComplete(parsed, selections));

	function choose(question: string, label: string, multiSelect: boolean) {
		const current = selections[question] ?? [];
		const picked = multiSelect
			? current.includes(label)
				? current.filter((entry) => entry !== label)
				: [...current, label]
			: [label];
		selections = { ...selections, [question]: picked };
		if (singleShot) submit(selections);
	}

	function answerFreeform(question: string) {
		const text = freeform[question]?.trim() ?? '';
		if (text.length === 0) return;
		const next = { ...selections, [question]: [text] };
		selections = next;
		if (singleShot) submit(next);
	}

	function submit(answers: Record<string, string[]>) {
		if (!parsed) return;
		respond('allow', withQuestionAnswers(parsed, answers));
	}

	function isPicked(question: string, label: string): boolean {
		return (selections[question] ?? []).includes(label);
	}
</script>

<Card surface="raised" padding="md" class="border border-violet">
	<div class="flex flex-col gap-4">
		<header class="flex items-center gap-2">
			<span class="text-violet"><ChatCircleTextIcon size={16} /></span>
			<span class="text-2xs tracking-caps uppercase text-violet">Question</span>
		</header>

		{#each questions as question (question.question)}
			<section class="flex flex-col gap-2">
				{#if question.header}
					<span class="w-fit rounded-full bg-raised px-2 py-0.5 text-2xs text-muted">{question.header}</span>
				{/if}
				<p class="text-sm text-default">{question.question}</p>

				<div class="grid gap-2 sm:grid-cols-2">
					{#each question.options as option (option.label)}
						<button
							type="button"
							class="flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors duration-fast {isPicked(
								question.question,
								option.label,
							)
								? 'border-violet bg-raised'
								: 'border-line hover:border-line-strong'}"
							onclick={() => choose(question.question, option.label, question.multiSelect === true)}
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
							if (event.key === 'Enter') answerFreeform(question.question);
						}}
						placeholder="Other — type your own answer"
						class="min-w-0 flex-1 rounded-md border border-line bg-input px-3 py-1.5 text-sm text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
					/>
					<Button
						size="sm"
						variant="ghost"
						disabled={(freeform[question.question] ?? '').trim().length === 0}
						onclick={() => answerFreeform(question.question)}>Use</Button
					>
				</div>
			</section>
		{/each}

		{#if questions.length === 0}
			<p class="text-xs text-dim">This question has no options the UI can render; allow or deny the raw call.</p>
		{/if}

		<footer class="flex items-center gap-2">
			{#if !singleShot && questions.length > 0}
				<Button disabled={!complete} onclick={() => submit(selections)}>Submit answers</Button>
			{/if}
			<Button variant="ghost" onclick={() => respond('deny')}>Skip</Button>
		</footer>
	</div>
</Card>
