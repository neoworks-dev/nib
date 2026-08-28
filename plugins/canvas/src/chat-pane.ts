export const chatPaneId = 'chat';

/**
 * Which conversation a chat pane is showing. The card is the identity: it keeps
 * its pane across everything that happens to the session underneath — being
 * launched from a goal, being handed to another harness — while the session id
 * rides along so a neighbouring pane can tell what it is sitting next to.
 *
 * A chat opened for a session with no card on the board carries the session id
 * alone, and one opened with no params at all follows the task in the foreground.
 *
 * An alias rather than an interface: the registry takes params as a
 * `Record<string, unknown>`, which only a type gets an index signature for.
 */
export type ChatPaneParams = {
	workstreamId?: string;
	sessionId?: string;
};

/** A workstream, as much of one as the params need. */
export interface ChatPaneTarget {
	id: string;
	sessionId?: string;
}

export function paramsForWorkstream(workstream: ChatPaneTarget): ChatPaneParams {
	if (!workstream.sessionId) return { workstreamId: workstream.id };
	return { workstreamId: workstream.id, sessionId: workstream.sessionId };
}
