import type {
  PaneAttachment,
  PaneDefinition,
  PaneDock,
  PaneEdge,
  PaneInstance,
  PaneLayout,
  PaneNode,
  PaneRegistry,
} from "@nib-ui/ui-contracts";
import {
  type Bounds,
  clampDockSize,
  DEFAULT_DOCK_SIZE,
  EDGE_ORDER,
  nearestEdge,
} from "../layout/docks";
import {
  insertAtEdge,
  insertBeside,
  leafNode,
  listLeaves,
  type NodePath,
  normalizeNode,
  removeLeaf,
  retainLeaves,
  setSizes,
} from "../layout/tree";

/** The view the shell is built around: it fills what the docks leave, and is never docked. */
export const rootPaneId = "canvas";

/** Where a pane opens, and which way a second one splits the dock it lands in. */
const OPENING_EDGE: PaneEdge = "right";
const OPENING_SPLIT: PaneEdge = "bottom";

let sequence = 0;

function createId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Params identify an instance — the same pane opened for two sessions is two
 * instances. Values are compared by identity, which is what a session id, a path
 * or a flag needs; an object literal rebuilt per call never matches.
 */
function sameParams(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}

/**
 * Panes, the instances of them that are open, and the docks those are attached
 * to. Nothing floats: a pane is always against an edge of the main area, and the
 * board keeps the middle — the docks are the only thing that can take space from
 * it, and they are capped so it never reaches nothing.
 */
export class ReactivePaneRegistry implements PaneRegistry {
  definitions = $state<PaneDefinition[]>([]);
  openPanes = $state<PaneInstance[]>([]);
  docks = $state<PaneDock[]>([]);
  bounds = $state<Bounds>({ width: 1280, height: 800 });
  focusedInstanceId = $state<string | null>(null);

  register(definition: PaneDefinition) {
    this.definitions = [...this.definitions, definition];
    return () => {
      // By id, not by identity: reading state hands back a proxy of the
      // definition, which is never the object the caller registered.
      this.definitions = this.definitions.filter((entry) => entry.id !== definition.id);
      this.close(definition.id);
    };
  }

  list(): PaneDefinition[] {
    return this.definitions;
  }

  definition(paneId: string): PaneDefinition | undefined {
    return this.definitions.find((entry) => entry.id === paneId);
  }

  instances(paneId?: string): PaneInstance[] {
    return paneId === undefined
      ? this.openPanes
      : this.openPanes.filter((entry) => entry.paneId === paneId);
  }

  instance(instanceId: string): PaneInstance | undefined {
    return this.openPanes.find((entry) => entry.instanceId === instanceId);
  }

  /** The instance and its definition, as a neighbour would want to read it. */
  attachment(instanceId: string): PaneAttachment | undefined {
    const instance = this.instance(instanceId);
    const definition = instance && this.definition(instance.paneId);
    if (!instance || !definition) return undefined;
    return {
      instanceId,
      paneId: instance.paneId,
      kind: definition.kind,
      title: definition.title,
      ...(instance.params ? { params: instance.params } : {}),
    };
  }

  dock(edge: PaneEdge): PaneDock | undefined {
    return this.docks.find((entry) => entry.edge === edge);
  }

  dockOf(instanceId: string): PaneDock | undefined {
    return this.docks.find((entry) => listLeaves(entry.root).includes(instanceId));
  }

  open(paneId: string, params?: Record<string, unknown>): string {
    if (paneId === rootPaneId) {
      this.focusedInstanceId = null;
      return rootPaneId;
    }

    const candidates = this.instances(paneId);
    const existing =
      params === undefined
        ? candidates.at(-1)
        : candidates.findLast((entry) => sameParams(entry.params, params));
    if (!existing) return this.openInstance(paneId, params);

    this.focusedInstanceId = existing.instanceId;
    return existing.instanceId;
  }

  /**
   * A pane opens against the right edge, and a second one splits that dock below
   * the first: a window is never dropped over the board for the user to place.
   */
  openInstance(paneId: string, params?: Record<string, unknown>): string {
    if (paneId === rootPaneId) return rootPaneId;
    const instanceId = createId("pane");
    this.openPanes = [...this.openPanes, { instanceId, paneId, ...(params ? { params } : {}) }];

    const dock = this.dock(OPENING_EDGE);
    if (dock) this.replaceDock(dock.edge, insertAtEdge(dock.root, instanceId, OPENING_SPLIT));
    else this.addDock(OPENING_EDGE, leafNode(instanceId));

    this.focusedInstanceId = instanceId;
    return instanceId;
  }

  /**
   * Re-keys an open instance. What a pane shows can move under it — a
   * conversation handed to another harness continues in a new session — and a
   * neighbouring pane reads these params to tell what it is next to, so they
   * follow the work rather than describe where it started.
   */
  reparam(instanceId: string, params?: Record<string, unknown>): void {
    if (!this.isInstanceOpen(instanceId)) return;
    this.openPanes = this.openPanes.map((entry) =>
      entry.instanceId === instanceId
        ? { instanceId, paneId: entry.paneId, ...(params ? { params } : {}) }
        : entry,
    );
  }

  close(paneId: string): void {
    if (paneId === rootPaneId) return;
    for (const instance of this.instances(paneId)) this.closeInstance(instance.instanceId);
  }

  closeInstance(instanceId: string): void {
    const dock = this.dockOf(instanceId);
    this.openPanes = this.openPanes.filter((entry) => entry.instanceId !== instanceId);
    if (dock) this.replaceDock(dock.edge, removeLeaf(dock.root, instanceId));
    if (this.focusedInstanceId === instanceId) this.focusFirst();
  }

  toggle(paneId: string): void {
    if (this.isOpen(paneId)) this.close(paneId);
    else this.open(paneId);
  }

  isOpen(paneId: string): boolean {
    return paneId === rootPaneId || this.openPanes.some((entry) => entry.paneId === paneId);
  }

  isInstanceOpen(instanceId: string): boolean {
    return this.openPanes.some((entry) => entry.instanceId === instanceId);
  }

  focusInstance(instanceId: string): void {
    if (!this.isInstanceOpen(instanceId)) return;
    this.focusedInstanceId = instanceId;
  }

  setDockSize(edge: PaneEdge, size: number): void {
    this.docks = this.docks.map((dock) =>
      dock.edge === edge ? { ...dock, size: clampDockSize(edge, size, this.bounds) } : dock,
    );
  }

  setSplitSizes(edge: PaneEdge, path: NodePath, sizes: number[]): void {
    this.docks = this.docks.map((dock) =>
      dock.edge === edge ? { ...dock, root: setSizes(dock.root, path, sizes) } : dock,
    );
  }

  /** Makes the instance a sibling of another one, on the given side of it. */
  attach(instanceId: string, targetInstanceId: string, edge: PaneEdge): void {
    const target = this.dockOf(targetInstanceId);
    if (!target || instanceId === targetInstanceId) return;
    this.move(instanceId, target.edge, (root) =>
      insertBeside(root, instanceId, targetInstanceId, edge),
    );
  }

  /**
   * Docks the instance against an edge of the area, splitting whatever is already
   * there along the dock's own axis. A pane that is the whole of the dock it is
   * dropped back onto stays where it is.
   */
  attachToEdge(instanceId: string, edge: PaneEdge): void {
    const source = this.dockOf(instanceId);
    if (!source) return;
    if (source.edge === edge && listLeaves(source.root).length < 2) return;

    const split = edge === "left" || edge === "right" ? "bottom" : "right";
    this.move(instanceId, edge, (root) => insertAtEdge(root, instanceId, split));
  }

  /** Where a pane let go over the area lands: the edge it was nearest. */
  dropAt(instanceId: string, x: number, y: number): void {
    this.attachToEdge(instanceId, nearestEdge(x, y, this.bounds));
  }

  /** Moves the instance to a dock of its own, on the first edge that has none. */
  detach(instanceId: string): void {
    const source = this.dockOf(instanceId);
    if (!source || listLeaves(source.root).length < 2) return;
    const free = EDGE_ORDER.find((edge) => this.dock(edge) === undefined);
    if (free) this.attachToEdge(instanceId, free);
  }

  private move(instanceId: string, edge: PaneEdge, insert: (root: PaneNode) => PaneNode): void {
    const source = this.dockOf(instanceId);
    if (!source) return;

    const sourceRoot = removeLeaf(source.root, instanceId);
    if (source.edge === edge) {
      // Rearranging inside one dock: the tree the leaf goes back into is the one
      // it was just taken out of, not the stale root. A leaf that was the whole
      // dock has nowhere to go back into, and stays where it is.
      if (!sourceRoot) return;
      this.replaceDock(edge, insert(sourceRoot));
      this.focusedInstanceId = instanceId;
      return;
    }

    const target = this.dock(edge);
    this.replaceDock(source.edge, sourceRoot);
    if (target) this.replaceDock(edge, insert(target.root));
    else this.addDock(edge, leafNode(instanceId));
    this.focusedInstanceId = instanceId;
  }

  /** A tree of null is a dock with nothing in it, which is no dock at all. */
  private replaceDock(edge: PaneEdge, root: PaneNode | null): void {
    this.docks = root
      ? this.docks.map((dock) => (dock.edge === edge ? { ...dock, root } : dock))
      : this.docks.filter((dock) => dock.edge !== edge);
  }

  private addDock(edge: PaneEdge, root: PaneNode): void {
    this.docks = [
      ...this.docks,
      { edge, size: clampDockSize(edge, DEFAULT_DOCK_SIZE, this.bounds), root },
    ];
  }

  /** The main area was measured or resized; docks follow it rather than crowd it out. */
  setBounds(bounds: Bounds): void {
    if (bounds.width === this.bounds.width && bounds.height === this.bounds.height) return;
    this.bounds = bounds;
    this.docks = this.docks.map((dock) => ({
      ...dock,
      size: clampDockSize(dock.edge, dock.size, bounds),
    }));
  }

  /** Plain values, not state proxies: this is what gets written to the board. */
  snapshotLayout(): PaneLayout {
    return $state.snapshot({ docks: this.docks, instances: this.openPanes }) as PaneLayout;
  }

  /**
   * Takes a stored layout as the current one. An instance whose pane no build
   * provides is dropped — a dock that could only render an error is worse than a
   * smaller layout — and the rest of the layout is kept.
   */
  restoreLayout(layout: PaneLayout | undefined): void {
    const provided = new Set(this.definitions.map((entry) => entry.id));
    const known = new Map(
      (layout?.instances ?? [])
        .filter((entry) => entry.paneId !== rootPaneId && provided.has(entry.paneId))
        .map((entry) => [entry.instanceId, entry]),
    );

    const placed = new Set<string>();
    const docks: PaneDock[] = [];
    for (const dock of layout?.docks ?? []) {
      if (docks.some((entry) => entry.edge === dock.edge)) continue;
      const root = retainLeaves(
        dock.root,
        (instanceId) => known.has(instanceId) && !placed.has(instanceId),
      );
      if (!root) continue;
      for (const instanceId of listLeaves(root)) placed.add(instanceId);
      docks.push({
        edge: dock.edge,
        size: clampDockSize(dock.edge, dock.size, this.bounds),
        root: normalizeNode(root),
      });
    }

    this.docks = docks;
    this.openPanes = [...placed].map((instanceId) => known.get(instanceId)!);
    this.focusFirst();
  }

  private focusFirst(): void {
    const dock = this.docks[0];
    this.focusedInstanceId = dock ? (listLeaves(dock.root)[0] ?? null) : null;
  }
}
