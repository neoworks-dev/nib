import type { SessionView } from '@nib-ui/protocol';
import { readFilePath, type PaneKind } from '@nib-ui/ui-contracts';
import { canvasObjectKindForPath } from './workspace-files';

/**
 * The file the session read most recently, or null when its newest tool call was
 * something else — a search, a command, a tool nothing in the shared vocabulary
 * names. Only the newest call counts: what the agent did three steps ago is
 * history, not a request to open anything.
 */
export function latestReadPath(session: SessionView): string | null {
	for (let message = session.messages.length - 1; message >= 0; message -= 1) {
		const blocks = session.messages[message]!.blocks;
		for (let index = blocks.length - 1; index >= 0; index -= 1) {
			const block = blocks[index]!;
			if (block.kind === 'tool_use') return readFilePath(block);
		}
	}
	return null;
}

/**
 * Where a file the agent just read should appear. `none` is the whole answer
 * when nothing that could show it is attached: a read with no editor beside it
 * reads exactly as it does today.
 */
export type ReadRoute = { kind: 'editor'; path: string } | { kind: 'model'; path: string } | { kind: 'none' };

export interface ReadRoutingInput {
	/** Newest file the session read, or null when its last tool call was not a read. */
	path: string | null;
	/** Kinds of the panes attached to the chat pane showing that session. */
	attached: PaneKind[];
	/** What was routed into those panes last, so one read is never opened twice. */
	lastRouted: string | null;
	/** False while the user is reading an older turn: nothing opens under them. */
	following: boolean;
}

export function routeRead({ path, attached, lastRouted, following }: ReadRoutingInput): ReadRoute {
	if (!path || !following || path === lastRouted) return { kind: 'none' };
	// A model goes to the viewer that can turn it, not to the editor that would
	// print its bytes — but only when one is actually attached.
	if (canvasObjectKindForPath(path) === 'model' && attached.includes('model')) return { kind: 'model', path };
	if (attached.includes('editor')) return { kind: 'editor', path };
	return { kind: 'none' };
}
