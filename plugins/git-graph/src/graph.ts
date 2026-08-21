export interface GraphCommit {
	hash: string;
	parents: string[];
}

/**
 * Segments inside one row's cell, with the commit dot sitting at the vertical centre:
 * `straight` spans the whole cell, `merge` runs from the top edge into the dot,
 * `branch` runs from the dot to the bottom edge.
 */
export type GraphEdgeKind = 'straight' | 'merge' | 'branch';

export interface GraphEdge {
	fromLane: number;
	toLane: number;
	kind: GraphEdgeKind;
	/** Colour of the lane the segment belongs to; a row draws lanes it does not own. */
	colourIndex: number;
}

export interface GraphRow<TCommit extends GraphCommit = GraphCommit> {
	commit: TCommit;
	lane: number;
	colourIndex: number;
	edges: GraphEdge[];
}

/**
 * Assigns a lane to every commit of an already topologically ordered log (newest first).
 * A lane holds the hash it is still waiting for; a commit claims the first lane waiting
 * for it, its first parent inherits that lane, further parents join or open lanes, and a
 * lane whose expected commit arrived without a successor is freed for reuse. Colours are
 * handed out per lane opening, so a reused lane index gets a fresh colour.
 */
export function assignLanes<TCommit extends GraphCommit>(commits: TCommit[]): GraphRow<TCommit>[] {
	const lanes: (string | null)[] = [];
	const laneColours: number[] = [];
	let nextColour = 0;
	const rows: GraphRow<TCommit>[] = [];

	const openLane = (): number => {
		const reused = lanes.indexOf(null);
		const lane = reused === -1 ? lanes.length : reused;
		lanes[lane] = null;
		laneColours[lane] = nextColour;
		nextColour += 1;
		return lane;
	};

	for (const commit of commits) {
		const waitingLanes: number[] = [];
		for (let index = 0; index < lanes.length; index += 1) {
			if (lanes[index] === commit.hash) waitingLanes.push(index);
		}

		const lane = waitingLanes[0] ?? openLane();
		const colourIndex = laneColours[lane] ?? 0;
		const edges: GraphEdge[] = [];

		for (const converging of waitingLanes.slice(1)) {
			edges.push({
				fromLane: converging,
				toLane: lane,
				kind: 'merge',
				colourIndex: laneColours[converging] ?? 0,
			});
			lanes[converging] = null;
		}

		for (let index = 0; index < lanes.length; index += 1) {
			if (index === lane || lanes[index] === null) continue;
			edges.push({ fromLane: index, toLane: index, kind: 'straight', colourIndex: laneColours[index] ?? 0 });
		}

		const [firstParent, ...otherParents] = commit.parents;
		if (firstParent) {
			lanes[lane] = firstParent;
			edges.push({
				fromLane: lane,
				toLane: lane,
				kind: waitingLanes.length > 0 ? 'straight' : 'branch',
				colourIndex,
			});
		} else {
			lanes[lane] = null;
			if (waitingLanes.length > 0) edges.push({ fromLane: lane, toLane: lane, kind: 'merge', colourIndex });
		}

		for (const parent of otherParents) {
			const joined = lanes.indexOf(parent);
			const target = joined === -1 ? openLane() : joined;
			lanes[target] = parent;
			edges.push({ fromLane: lane, toLane: target, kind: 'branch', colourIndex: laneColours[target] ?? 0 });
		}

		while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

		rows.push({ commit, lane, colourIndex, edges });
	}

	return rows;
}

/** Widest point of the graph, so every row can render an equally wide lane column. */
export function laneCount(rows: GraphRow[]): number {
	let count = 1;
	for (const row of rows) {
		count = Math.max(count, row.lane + 1);
		for (const edge of row.edges) count = Math.max(count, edge.fromLane + 1, edge.toLane + 1);
	}
	return count;
}
