/** A passage the user highlighted in the transcript and staged for the next prompt. */
export interface StagedAnnotation {
	id: string;
	sessionId: string;
	/** The turn the selection anchor sat in — a selection spanning turns keeps the anchor's. */
	messageId: string;
	text: string;
	/** What the user wrote about the passage; a bare quote carries none. */
	note?: string;
}

/**
 * Selections routinely pick up the whitespace around a line, and a quote made of
 * nothing but whitespace carries no meaning, so it is refused outright. A note of
 * only whitespace is dropped instead, leaving the plain quote.
 */
export function createAnnotation(
	sessionId: string,
	messageId: string,
	selectedText: string,
	comment = '',
): StagedAnnotation | null {
	const text = selectedText.trim();
	if (text.length === 0) return null;
	const note = comment.trim();
	return { id: crypto.randomUUID(), sessionId, messageId, text, ...(note.length > 0 && { note }) };
}

/**
 * Quotes lead, the typed prompt follows: every annotation becomes its own markdown
 * blockquote so the harness sees what the user pointed at before what they asked.
 * A note follows its quote across a blank line — attached directly it would be
 * lazily continued into the blockquote.
 */
export function composeAnnotatedMessage(annotations: StagedAnnotation[], draft: string): string {
	const prompt = draft.trim();
	if (annotations.length === 0) return prompt;

	const quotes = annotations.map((annotation) => {
		const quote = annotation.text
			.split('\n')
			// A bare `>` keeps blank lines inside the quote without trailing whitespace.
			.map((line) => (line.trim().length === 0 ? '>' : `> ${line}`))
			.join('\n');
		return annotation.note ? `${quote}\n\n${annotation.note}` : quote;
	});

	const quoted = quotes.join('\n\n');
	return prompt.length === 0 ? quoted : `${quoted}\n\n${prompt}`;
}
