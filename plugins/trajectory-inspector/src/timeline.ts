import type { TraceNode } from './trace';

export type TimelineLane = 'input' | 'model' | 'tools';

export interface TimelineMark {
	nodeId: string;
	lane: TimelineLane;
	/** Fractions of the session's span, so the strip is resolution-independent. */
	start: number;
	end: number;
	status: TraceNode['status'];
}

export interface Timeline {
	from: number;
	to: number;
	marks: TimelineMark[];
}

export interface TimeRange {
	from: number;
	to: number;
}

const minimumWidth = 0.002;

/** Bookkeeping events (status, usage, logs) have no lane: they would drown the strip. */
export function laneOf(node: TraceNode): TimelineLane | null {
	if (node.kind === 'tool' || node.kind === 'permission') return 'tools';
	if (node.kind === 'text' || node.kind === 'thinking') return 'model';
	if (node.kind !== 'message') return null;
	return node.badge === 'USER' ? 'input' : 'model';
}

/** Lays every step on a shared 0..1 axis spanning the whole session. */
export function buildTimeline(nodes: TraceNode[]): Timeline {
	if (nodes.length === 0) return { from: 0, to: 0, marks: [] };

	const from = Math.min(...nodes.map((node) => node.ts));
	const to = Math.max(...nodes.map((node) => node.ts + (node.durationMs ?? 0)));
	const span = Math.max(1, to - from);

	const marks: TimelineMark[] = [];
	for (const node of nodes) {
		const lane = laneOf(node);
		if (!lane) continue;
		const start = (node.ts - from) / span;
		const end = (node.ts + (node.durationMs ?? 0) - from) / span;
		marks.push({
			nodeId: node.id,
			lane,
			start,
			end: Math.min(1, Math.max(end, start + minimumWidth)),
			status: node.status,
		});
	}
	return { from, to, marks };
}

/** A step is kept when it overlaps the brushed window at all. */
export function withinRange(node: TraceNode, range: TimeRange | null): boolean {
	if (!range) return true;
	const start = node.ts;
	const end = node.ts + (node.durationMs ?? 0);
	return end >= range.from && start <= range.to;
}

export function rangeFromFractions(timeline: Timeline, first: number, second: number): TimeRange {
	const span = Math.max(1, timeline.to - timeline.from);
	const low = Math.max(0, Math.min(first, second));
	const high = Math.min(1, Math.max(first, second));
	return { from: timeline.from + low * span, to: timeline.from + high * span };
}

export function fractionsOfRange(timeline: Timeline, range: TimeRange): { start: number; end: number } {
	const span = Math.max(1, timeline.to - timeline.from);
	return { start: (range.from - timeline.from) / span, end: (range.to - timeline.from) / span };
}
