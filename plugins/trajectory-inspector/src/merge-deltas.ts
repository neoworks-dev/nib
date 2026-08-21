import { isKnownEvent, type AnyAgentEvent } from '@nib-ui/protocol';

export interface TrajectoryRow {
	event: AnyAgentEvent;
	/** How many raw events this row stands for; 1 for everything but merged deltas. */
	mergedCount: number;
	firstSeq: number;
}

/**
 * A streamed answer is hundreds of one-token `block.delta` events. Consecutive
 * deltas for the same block become one row carrying the concatenated text, so
 * the log stays readable while the payload pane still shows the whole delta.
 */
export function mergeDeltas(events: AnyAgentEvent[]): TrajectoryRow[] {
	const rows: TrajectoryRow[] = [];

	for (const event of events) {
		const previous = rows[rows.length - 1];
		if (!isDelta(event) || !previous || !isDelta(previous.event) || previous.event.data.blockId !== event.data.blockId) {
			rows.push({ event, mergedCount: 1, firstSeq: event.seq });
			continue;
		}

		rows[rows.length - 1] = {
			event: {
				...event,
				data: {
					blockId: event.data.blockId,
					textDelta: concat(previous.event.data.textDelta, event.data.textDelta),
					inputJsonDelta: concat(previous.event.data.inputJsonDelta, event.data.inputJsonDelta),
				},
			},
			mergedCount: previous.mergedCount + 1,
			firstSeq: previous.firstSeq,
		};
	}

	return rows;
}

type DeltaEvent = AnyAgentEvent & { type: 'block.delta'; data: { blockId: string; textDelta?: string; inputJsonDelta?: string } };

function isDelta(event: AnyAgentEvent): event is DeltaEvent {
	return isKnownEvent(event) && event.type === 'block.delta';
}

function concat(left: string | undefined, right: string | undefined): string | undefined {
	if (left === undefined && right === undefined) return undefined;
	return `${left ?? ''}${right ?? ''}`;
}
