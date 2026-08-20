import { z } from 'zod';

export const askUserQuestionToolName = 'AskUserQuestion';

export const askQuestionOptionSchema = z.object({
	label: z.string(),
	description: z.string().optional(),
	preview: z.string().optional(),
});

export const askQuestionSchema = z.object({
	question: z.string(),
	header: z.string().optional(),
	options: z.array(askQuestionOptionSchema).default([]),
	multiSelect: z.boolean().optional(),
});

export const askUserQuestionInputSchema = z.looseObject({
	questions: z.array(askQuestionSchema).min(1),
});

export type AskQuestionOption = z.infer<typeof askQuestionOptionSchema>;
export type AskQuestion = z.infer<typeof askQuestionSchema>;
export type AskUserQuestionInput = z.infer<typeof askUserQuestionInputSchema>;

/** A tool call this build can answer inline; anything else falls back to allow/deny. */
export function parseAskUserQuestion(input: unknown): AskUserQuestionInput | null {
	const parsed = askUserQuestionInputSchema.safeParse(input);
	return parsed.success ? parsed.data : null;
}

/**
 * The tool reads `answers` off its own input, so allowing the call with the
 * answers filled in resolves the dialog without a second round trip. Keys are
 * question texts and multi-select answers are comma-separated — that is the
 * shape the tool documents for its result.
 */
export function withQuestionAnswers(
	input: AskUserQuestionInput,
	selections: Record<string, string[]>,
): AskUserQuestionInput & { answers: Record<string, string> } {
	const answers: Record<string, string> = {};
	for (const question of input.questions) {
		const picked = selections[question.question]?.filter((entry) => entry.trim().length > 0) ?? [];
		if (picked.length > 0) answers[question.question] = picked.join(',');
	}
	return { ...input, answers };
}

export function isAnswerComplete(input: AskUserQuestionInput, selections: Record<string, string[]>): boolean {
	return input.questions.every((question) => (selections[question.question]?.length ?? 0) > 0);
}
