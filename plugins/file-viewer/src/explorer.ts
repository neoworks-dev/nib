/**
 * An editor is easier to use with the tree beside it, so opening one opens an
 * explorer against it — once. Taking that explorer away is an answer, not an
 * accident, so it is never brought back.
 */
export type ExplorerPlan = 'attach' | 'keep' | 'dismissed';

export interface ExplorerState {
	/** An explorer is a sibling of this editor right now. */
	attached: boolean;
	/** An explorer was opened for this editor at some point in its life. */
	paired: boolean;
}

export function planExplorer({ attached, paired }: ExplorerState): ExplorerPlan {
	if (attached) return 'keep';
	// Opened once and no longer there: the user closed it or dragged it off.
	if (paired) return 'dismissed';
	return 'attach';
}
