import type { PaneAxis, PaneEdge, PaneNode } from "@nib-ui/ui-contracts";
import { MIN_DOCK_HEIGHT, MIN_DOCK_WIDTH } from "./docks";

/** Index of a child, repeated per level: how a component addresses a split it renders. */
export type NodePath = number[];

export function leafNode(instanceId: string): PaneNode {
  return { kind: "leaf", instanceId };
}

export function axisOf(edge: PaneEdge): PaneAxis {
  return edge === "left" || edge === "right" ? "row" : "column";
}

function leading(edge: PaneEdge): boolean {
  return edge === "left" || edge === "top";
}

/** Fractions of the split's extent, one per child, summing to 1. */
export function normalizeSizes(sizes: readonly number[], count: number): number[] {
  if (count <= 0) return [];
  const share = 1 / count;
  const values = Array.from({ length: count }, (_, index) => {
    const value = sizes[index];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : share;
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

/** A split of one child is that child: the tree never keeps a pointless level. */
function split(axis: PaneAxis, children: PaneNode[], sizes: readonly number[]): PaneNode {
  if (children.length === 1) return children[0]!;
  return { kind: "split", axis, children, sizes: normalizeSizes(sizes, children.length) };
}

export function listLeaves(node: PaneNode): string[] {
  if (node.kind === "leaf") return [node.instanceId];
  return node.children.flatMap(listLeaves);
}

export function hasLeaf(node: PaneNode, instanceId: string): boolean {
  return leafPath(node, instanceId) !== null;
}

/** Where a leaf sits, as child indexes from the root; `[]` when it is the root. */
export function leafPath(node: PaneNode, instanceId: string): NodePath | null {
  if (node.kind === "leaf") return node.instanceId === instanceId ? [] : null;
  for (const [index, child] of node.children.entries()) {
    const path = leafPath(child, instanceId);
    if (path) return [index, ...path];
  }
  return null;
}

export function nodeAt(node: PaneNode, path: NodePath): PaneNode | null {
  let current: PaneNode | undefined = node;
  for (const index of path) {
    if (!current || current.kind !== "split") return null;
    current = current.children[index];
  }
  return current ?? null;
}

/** Adds a leaf against one edge of the whole tree — a drop on a frame's edge. */
export function insertAtEdge(root: PaneNode, instanceId: string, edge: PaneEdge): PaneNode {
  const axis = axisOf(edge);
  if (root.kind === "split" && root.axis === axis) {
    const share = 1 / (root.children.length + 1);
    const children = leading(edge)
      ? [leafNode(instanceId), ...root.children]
      : [...root.children, leafNode(instanceId)];
    const sizes = leading(edge) ? [share, ...root.sizes] : [...root.sizes, share];
    return split(axis, children, sizes);
  }
  const children = leading(edge) ? [leafNode(instanceId), root] : [root, leafNode(instanceId)];
  return split(axis, children, [0.5, 0.5]);
}

/**
 * Adds a leaf beside another one, wherever in the tree that one sits. The new
 * leaf takes half of the target's share, so the rest of the frame is undisturbed.
 * Returns the tree unchanged when the target is not in it.
 */
export function insertBeside(
  root: PaneNode,
  instanceId: string,
  targetInstanceId: string,
  edge: PaneEdge,
): PaneNode {
  return insertInto(root, instanceId, targetInstanceId, edge) ?? root;
}

function insertInto(
  node: PaneNode,
  instanceId: string,
  targetInstanceId: string,
  edge: PaneEdge,
): PaneNode | null {
  if (node.kind === "leaf") {
    return node.instanceId === targetInstanceId ? insertAtEdge(node, instanceId, edge) : null;
  }

  const index = node.children.findIndex(
    (child) => child.kind === "leaf" && child.instanceId === targetInstanceId,
  );
  if (index >= 0 && node.axis === axisOf(edge)) {
    const half = (node.sizes[index] ?? 1 / node.children.length) / 2;
    const children = [...node.children];
    const sizes = [...node.sizes];
    children.splice(leading(edge) ? index : index + 1, 0, leafNode(instanceId));
    sizes.splice(index, 1, half, half);
    return split(node.axis, children, sizes);
  }

  for (const [position, child] of node.children.entries()) {
    const replaced = insertInto(child, instanceId, targetInstanceId, edge);
    if (!replaced) continue;
    const children = [...node.children];
    children[position] = replaced;
    return split(node.axis, children, node.sizes);
  }
  return null;
}

/** Null when the tree held nothing else: the frame around it goes with it. */
export function removeLeaf(root: PaneNode, instanceId: string): PaneNode | null {
  return retainLeaves(root, (leaf) => leaf !== instanceId);
}

/** Drops every leaf the predicate rejects, collapsing the splits left behind. */
export function retainLeaves(
  node: PaneNode,
  keep: (instanceId: string) => boolean,
): PaneNode | null {
  if (node.kind === "leaf") return keep(node.instanceId) ? node : null;

  const children: PaneNode[] = [];
  const sizes: number[] = [];
  let changed = false;

  for (const [index, child] of node.children.entries()) {
    const next = retainLeaves(child, keep);
    if (next !== child) changed = true;
    if (!next) continue;
    children.push(next);
    sizes.push(node.sizes[index] ?? 0);
  }

  if (!changed) return node;
  if (children.length === 0) return null;
  return split(node.axis, children, sizes);
}

/** Re-runs the size invariant over a tree that came from storage. */
export function normalizeNode(node: PaneNode): PaneNode {
  if (node.kind === "leaf") return node;
  return split(node.axis, node.children.map(normalizeNode), node.sizes);
}

export function setSizes(root: PaneNode, path: NodePath, sizes: number[]): PaneNode {
  const target = nodeAt(root, path);
  if (!target || target.kind !== "split") return root;
  const replaced: PaneNode = { ...target, sizes: normalizeSizes(sizes, target.children.length) };
  return replaceAt(root, path, replaced);
}

function replaceAt(node: PaneNode, path: NodePath, replacement: PaneNode): PaneNode {
  const [index, ...rest] = path;
  if (index === undefined) return replacement;
  if (node.kind !== "split" || !node.children[index]) return node;
  const children = [...node.children];
  children[index] = replaceAt(node.children[index]!, rest, replacement);
  return { ...node, children };
}

/**
 * Drags the splitter after `index`. `delta` is a fraction of the split's own
 * extent, and neither neighbour may fall below `minimum` — unless there is not
 * enough room to give both that much, in which case they share what there is.
 */
export function resizeSiblings(
  sizes: readonly number[],
  index: number,
  delta: number,
  minimum = 0,
): number[] {
  const values = normalizeSizes(sizes, sizes.length);
  const before = values[index];
  const after = values[index + 1];
  if (before === undefined || after === undefined) return values;

  const total = before + after;
  const floor = Math.min(Math.max(minimum, 0), total / 2);
  values[index] = Math.min(Math.max(before + delta, floor), total - floor);
  values[index + 1] = total - values[index]!;
  return values;
}

/** The smallest share a leaf may take, where the frame is big enough to grant it. */
export function minimumFraction(axis: PaneAxis, extent: number, count: number): number {
  if (extent <= 0 || count <= 0) return 0;
  const minimum = axis === "row" ? MIN_DOCK_WIDTH : MIN_DOCK_HEIGHT;
  return Math.min(minimum / extent, 1 / count);
}

/** A box in the coordinates the drop tests are run in — the pane host's own. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a leaf sits in its dock, as fractions of the dock's box. */
export interface LeafPlacement {
  instanceId: string;
  box: Box;
  /** The sides a splitter runs along, which the leaf gives half the splitter to. */
  gutters: Record<PaneEdge, boolean>;
}

/** The boundary after one child of a split, and the split it divides. */
export interface SplitterPlacement {
  key: string;
  path: NodePath;
  index: number;
  axis: PaneAxis;
  /** The split's own extent along its axis, as a fraction of the dock. */
  extent: number;
  /** A line of no thickness on the boundary, spanning the split across its axis. */
  box: Box;
}

export interface TreeLayout {
  leaves: LeafPlacement[];
  splitters: SplitterPlacement[];
}

/**
 * Flattens the tree into boxes, so a dock is drawn as one list of leaves rather
 * than as nested splits: a leaf that gains a sibling or moves to another split
 * keeps its element, and whatever is running in it, instead of being remounted
 * under a new parent.
 */
export function layoutTree(root: PaneNode): TreeLayout {
  const layout: TreeLayout = { leaves: [], splitters: [] };
  const none: Record<PaneEdge, boolean> = { left: false, right: false, top: false, bottom: false };
  place(root, { x: 0, y: 0, width: 1, height: 1 }, none, [], layout);
  return layout;
}

function place(
  node: PaneNode,
  box: Box,
  gutters: Record<PaneEdge, boolean>,
  path: NodePath,
  layout: TreeLayout,
): void {
  if (node.kind === "leaf") {
    layout.leaves.push({ instanceId: node.instanceId, box, gutters });
    return;
  }

  const row = node.axis === "row";
  const sizes = normalizeSizes(node.sizes, node.children.length);
  const extent = row ? box.width : box.height;
  const last = node.children.length - 1;
  let offset = row ? box.x : box.y;

  for (const [index, child] of node.children.entries()) {
    const size = sizes[index];
    if (size === undefined) continue;
    const share = extent * size;
    const childBox = row
      ? { x: offset, y: box.y, width: share, height: box.height }
      : { x: box.x, y: offset, width: box.width, height: share };
    const childGutters = row
      ? { ...gutters, left: gutters.left || index > 0, right: gutters.right || index < last }
      : { ...gutters, top: gutters.top || index > 0, bottom: gutters.bottom || index < last };
    place(child, childBox, childGutters, [...path, index], layout);
    offset += share;

    if (index === last) continue;
    layout.splitters.push({
      key: `${path.join(".")}/${index}`,
      path,
      index,
      axis: node.axis,
      extent,
      box: row
        ? { x: offset, y: box.y, width: 0, height: box.height }
        : { x: box.x, y: offset, width: box.width, height: 0 },
    });
  }
}

export function pointInBox(box: Box, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/**
 * Which edge a pointer over a pane would attach to. The pane is cut into four
 * triangles about its centre, so exactly one edge is ever the answer.
 */
export function dropEdge(box: Box, x: number, y: number): PaneEdge {
  const horizontal = box.width > 0 ? (x - (box.x + box.width / 2)) / box.width : 0;
  const vertical = box.height > 0 ? (y - (box.y + box.height / 2)) / box.height : 0;
  if (Math.abs(horizontal) >= Math.abs(vertical)) return horizontal >= 0 ? "right" : "left";
  return vertical >= 0 ? "bottom" : "top";
}
