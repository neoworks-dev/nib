import type { TraceNode } from './trace';

export type TimelineLane = 'input' | 'model' | 'tools';

export interface TimelineMark {
	nodeId: string;
	/** Null for bookkeeping steps: they hold a slot on the axis but draw nothing. */
	lane: TimelineLane | null;
	/** Fractions of the compressed axis, so the strip is resolution-independent. */
	start: number;
	end: number;
	status: TraceNode['status'];
}

export interface Timeline {
	/** Wall-clock bounds, kept for the duration readout only. */
	from: number;
	to: number;
	marks: TimelineMark[];
}

/** A brushed window, in fractions of the compressed axis. */
export interface TimeRange {
	from: number;
	to: number;
}

/** Every step is at least this wide so a zero-duration one stays clickable. */
const minimumSlice = 60;
/** Idle time between steps collapses to this, so waiting never dominates the strip. */
const maximumGap = 40;

export function laneOf(node: TraceNode): TimelineLane | null {
	if (node.kind === 'tool' || node.kind === 'permission') return 'tools';
	if (node.kind === 'text' || node.kind === 'thinking') return 'model';
	if (node.kind !== 'message') return null;
	return node.badge === 'USER' ? 'input' : 'model';
}

/**
 * Lays the steps out on activity time rather than wall-clock time: each step
 * keeps its own duration, but the idle stretch before it is clamped, so a
 * session that sat waiting for a prompt still reads as one continuous run.
 */
export function buildTimeline(nodes: TraceNode[]): Timeline {
	if (nodes.length === 0) return { from: 0, to: 0, marks: [] };

	const ordered = [...nodes].sort((left, right) => left.ts - right.ts || left.seq - right.seq);
	const spans: { nodeId: string; lane: TimelineLane | null; status: TraceNode['status']; start: number; end: number }[] = [];

	let cursor = 0;
	let previousEnd: number | null = null;
	for (const node of ordered) {
		const duration = Math.max(node.durationMs ?? 0, minimumSlice);
		if (previousEnd !== null) cursor += Math.min(Math.max(0, node.ts - previousEnd), maximumGap);
		spans.push({ nodeId: node.id, lane: laneOf(node), status: node.status, start: cursor, end: cursor + duration });
		cursor += duration;
		previousEnd = node.ts + (node.durationMs ?? 0);
	}

	const total = Math.max(1, cursor);
	return {
		from: Math.min(...nodes.map((node) => node.ts)),
		to: Math.max(...nodes.map((node) => node.ts + (node.durationMs ?? 0))),
		marks: spans.map((span) => ({
			nodeId: span.nodeId,
			lane: span.lane,
			status: span.status,
			start: span.start / total,
			end: span.end / total,
		})),
	};
}

export function markIndex(timeline: Timeline): Map<string, TimelineMark> {
	return new Map(timeline.marks.map((mark) => [mark.nodeId, mark]));
}

/** A step is kept when its slot overlaps the brushed window at all. */
export function withinRange(mark: TimelineMark | undefined, range: TimeRange | null): boolean {
	if (!range) return true;
	if (!mark) return false;
	return mark.end >= range.from && mark.start <= range.to;
}

export function rangeFromFractions(first: number, second: number): TimeRange {
	return { from: Math.max(0, Math.min(first, second)), to: Math.min(1, Math.max(first, second)) };
}
