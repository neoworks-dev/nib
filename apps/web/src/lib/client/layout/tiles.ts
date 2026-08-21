export type SplitDirection = 'row' | 'column';
export type DropEdge = 'left' | 'right' | 'top' | 'bottom';

export type TileNode =
	| { kind: 'leaf'; paneId: string }
	| { kind: 'split'; direction: SplitDirection; ratio: number; first: TileNode; second: TileNode };

const minimumRatio = 0.15;

export function leaf(paneId: string): TileNode {
	return { kind: 'leaf', paneId };
}

export function paneIds(node: TileNode | null): string[] {
	if (!node) return [];
	if (node.kind === 'leaf') return [node.paneId];
	return [...paneIds(node.first), ...paneIds(node.second)];
}

export function containsPane(node: TileNode | null, paneId: string): boolean {
	return paneIds(node).includes(paneId);
}

/** Splits the target leaf, putting the new pane on the given edge. */
export function insertPane(node: TileNode | null, targetPaneId: string | null, edge: DropEdge, paneId: string): TileNode {
	if (!node) return leaf(paneId);
	const withoutPane = removePane(node, paneId) ?? leaf(paneId);
	if (paneIds(withoutPane).length === 0) return leaf(paneId);
	const target = targetPaneId && containsPane(withoutPane, targetPaneId) ? targetPaneId : paneIds(withoutPane)[0]!;
	return splitAt(withoutPane, target, edge, paneId);
}

export function removePane(node: TileNode | null, paneId: string): TileNode | null {
	if (!node) return null;
	if (node.kind === 'leaf') return node.paneId === paneId ? null : node;

	const first = removePane(node.first, paneId);
	const second = removePane(node.second, paneId);
	if (first && second) return { ...node, first, second };
	return first ?? second;
}

/** Alt+drag lands here: the pane leaves its old slot and splits the drop target. */
export function movePane(node: TileNode | null, paneId: string, targetPaneId: string, edge: DropEdge): TileNode | null {
	if (paneId === targetPaneId) return node;
	const remaining = removePane(node, paneId);
	if (!remaining) return leaf(paneId);
	if (!containsPane(remaining, targetPaneId)) return remaining;
	return splitAt(remaining, targetPaneId, edge, paneId);
}

export function setRatio(node: TileNode, path: number[], ratio: number): TileNode {
	if (path.length === 0 || node.kind !== 'split') {
		return node.kind === 'split' ? { ...node, ratio: clamp(ratio) } : node;
	}
	const [step, ...rest] = path;
	const child = step === 0 ? node.first : node.second;
	const updated = setRatio(child, rest, ratio);
	return step === 0 ? { ...node, first: updated } : { ...node, second: updated };
}

function splitAt(node: TileNode, targetPaneId: string, edge: DropEdge, paneId: string): TileNode {
	if (node.kind === 'leaf') {
		if (node.paneId !== targetPaneId) return node;
		const direction: SplitDirection = edge === 'left' || edge === 'right' ? 'row' : 'column';
		const before = edge === 'left' || edge === 'top';
		return {
			kind: 'split',
			direction,
			ratio: 0.5,
			first: before ? leaf(paneId) : node,
			second: before ? node : leaf(paneId),
		};
	}
	return { ...node, first: splitAt(node.first, targetPaneId, edge, paneId), second: splitAt(node.second, targetPaneId, edge, paneId) };
}

function clamp(ratio: number): number {
	return Math.min(1 - minimumRatio, Math.max(minimumRatio, ratio));
}

/** Which quarter of a pane the pointer sits in decides the split edge. */
export function edgeFromPoint(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): DropEdge {
	const fromLeft = (clientX - rect.left) / rect.width;
	const fromTop = (clientY - rect.top) / rect.height;
	const horizontal = Math.min(fromLeft, 1 - fromLeft);
	const vertical = Math.min(fromTop, 1 - fromTop);
	if (horizontal <= vertical) return fromLeft < 0.5 ? 'left' : 'right';
	return fromTop < 0.5 ? 'top' : 'bottom';
}
