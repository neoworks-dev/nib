import type { CanvasObject } from '@nib-ui/ui-contracts';
import { isWorkstream } from './workstream';

export type SpawnPlan =
	| { kind: 'fork'; sourceId: string; nativeSessionId: string }
	| { kind: 'branch'; sourceId: string }
	| { kind: 'join'; sourceIds: string[] }
	| { kind: 'assets'; sourceIds: string[] };

/**
 * What a task dragged out of `sources` should be. One workstream whose harness
 * conversation can be forked inherits it whole, which no digest can match;
 * everything else has to travel as text in the first prompt.
 *
 * A workstream in the selection decides what is started, and the objects around
 * it are dropped: what a task continues is a thread, not a picture beside it.
 * With no workstream at all, those objects are the whole of it — a task started
 * from what they hold.
 */
export function planSpawn(
	sources: CanvasObject[],
	forkableNativeId: (sessionId: string) => string | null,
): SpawnPlan | null {
	const workstreams = sources.filter(isWorkstream);
	if (workstreams.length === 0) {
		const carried = sources.filter((object) => object.kind !== 'edge');
		return carried.length > 0 ? { kind: 'assets', sourceIds: carried.map((object) => object.id) } : null;
	}
	if (workstreams.length > 1) return { kind: 'join', sourceIds: workstreams.map((object) => object.id) };

	const only = workstreams[0]!;
	const nativeSessionId = only.sessionId ? forkableNativeId(only.sessionId) : null;
	return nativeSessionId
		? { kind: 'fork', sourceId: only.id, nativeSessionId }
		: { kind: 'branch', sourceId: only.id };
}
