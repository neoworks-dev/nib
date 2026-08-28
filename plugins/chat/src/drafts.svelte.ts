/**
 * Adds a file reference to a draft in the `@path` form the composer's own file
 * trigger produces, with a trailing space so the next word is not glued to it.
 * A path already referenced is left alone rather than repeated.
 */
export function stageReference(draft: string, path: string): string {
	const reference = `@${path}`;
	if (draft.split(/\s+/).includes(reference)) return draft;
	const head = draft.trimEnd();
	return head.length === 0 ? `${reference} ` : `${head} ${reference} `;
}

/**
 * What is typed but not yet sent, per session. It lives outside the composer so
 * that dropping a file on a task can put a reference in front of the user
 * without sending anything, and so a chat pane closed mid-sentence reopens on it.
 */
class ComposerDrafts {
	private texts = $state<Record<string, string>>({});

	get(sessionId: string): string {
		return this.texts[sessionId] ?? '';
	}

	set(sessionId: string, text: string): void {
		this.texts = { ...this.texts, [sessionId]: text };
	}

	/** Stages a file as context for a task. Sending it stays the user's move. */
	stage(sessionId: string, path: string): void {
		this.set(sessionId, stageReference(this.get(sessionId), path));
	}
}

export const composerDrafts = new ComposerDrafts();
