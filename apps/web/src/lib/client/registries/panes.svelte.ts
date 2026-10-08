import type {
  PaneAttachment,
  PaneDefinition,
  PaneDock,
  PaneDrawer,
  PaneEdge,
  PaneInstance,
  PaneLayout,
  PaneNode,
  PanePresentation,
  PaneRegistry,
  PaneSheet,
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

/**
 * The shell's own view of the pane service: the layout components read docks,
 * the drawer and the sheets, which the contract a plugin sees does not carry.
 */
export function reactivePanes(registry: PaneRegistry): ReactivePaneRegistry {
  if (registry instanceof ReactivePaneRegistry) return registry;
  throw new Error("The pane host needs the shell's own pane registry");
}

/** The view the shell is built around: it fills what the docks leave, and is never docked. */
export const rootPaneId = "canvas";

/** Where a pane opens, and which way a second one splits the dock it lands in. */
const OPENING_EDGE: PaneEdge = "right";
const OPENING_SPLIT: PaneEdge = "bottom";

/**
 * One tree of panes and where it is shown: a dock against an edge, the drawer
 * over the board's right side, or one of the sheets raised over everything.
 */
export type PaneFrame =
  { layer: "dock"; edge: PaneEdge } | { layer: "drawer" } | { layer: "sheet"; sheetId: string };

/** Whether two addresses name the same tree. */
function sameFrame(left: PaneFrame, right: PaneFrame): boolean {
  if (left.layer === "dock" && right.layer === "dock") return left.edge === right.edge;
  if (left.layer === "sheet" && right.layer === "sheet") return left.sheetId === right.sheetId;
  return left.layer === right.layer;
}

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
 * Panes, the instances of them that are open, and the trees those sit in. A
 * docked pane is against an edge of the main area and the board keeps the middle
 * — the docks are capped so it never reaches nothing. The drawer and the sheets
 * are layers over the board instead, for the panes that ask to be one.
 */
export class ReactivePaneRegistry implements PaneRegistry {
  definitions = $state<PaneDefinition[]>([]);
  openPanes = $state<PaneInstance[]>([]);
  docks = $state<PaneDock[]>([]);
  drawer = $state<PaneDrawer | null>(null);
  /** Oldest first: the last one is in front. */
  sheets = $state<PaneSheet[]>([]);
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

  /** Every tree on screen, docks first and the front sheet last. */
  frames(): PaneFrame[] {
    const frames: PaneFrame[] = this.docks.map((dock) => ({ layer: "dock", edge: dock.edge }));
    if (this.drawer) frames.push({ layer: "drawer" });
    for (const sheet of this.sheets) frames.push({ layer: "sheet", sheetId: sheet.sheetId });
    return frames;
  }

  /** The tree the instance sits in, wherever that is shown. */
  frameOf(instanceId: string): PaneFrame | undefined {
    return this.frames().find((frame) => {
      const root = this.rootOf(frame);
      return root !== undefined && listLeaves(root).includes(instanceId);
    });
  }

  rootOf(frame: PaneFrame): PaneNode | undefined {
    if (frame.layer === "dock") return this.dock(frame.edge)?.root;
    if (frame.layer === "drawer") return this.drawer?.root;
    return this.sheets.find((sheet) => sheet.sheetId === frame.sheetId)?.root;
  }

  /** How a pane asks to be shown; a pane no plugin provides any more docks. */
  presentationOf(paneId: string): PanePresentation {
    return this.definition(paneId)?.presentation ?? "dock";
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

    this.raise(existing.instanceId);
    this.focusedInstanceId = existing.instanceId;
    return existing.instanceId;
  }

  /**
   * A docked pane opens against the right edge, and a second one splits that dock
   * below the first: a window is never dropped over the board for the user to
   * place. A drawer pane joins the drawer the same way; a sheet pane is a sheet of
   * its own, in front of any already raised.
   */
  openInstance(paneId: string, params?: Record<string, unknown>): string {
    if (paneId === rootPaneId) return rootPaneId;
    const instanceId = createId("pane");
    this.openPanes = [...this.openPanes, { instanceId, paneId, ...(params ? { params } : {}) }];
    this.place(instanceId, this.presentationOf(paneId));
    this.focusedInstanceId = instanceId;
    return instanceId;
  }

  /** Puts an instance that is in no tree yet where its presentation says it opens. */
  private place(instanceId: string, presentation: PanePresentation): void {
    if (presentation === "sheet") {
      this.sheets = [...this.sheets, { sheetId: createId("sheet"), root: leafNode(instanceId) }];
      return;
    }
    if (presentation === "drawer") {
      if (this.drawer)
        this.replaceRoot(
          { layer: "drawer" },
          insertAtEdge(this.drawer.root, instanceId, OPENING_SPLIT),
        );
      else this.addFrame({ layer: "drawer" }, leafNode(instanceId));
      return;
    }
    const dock = this.dock(OPENING_EDGE);
    if (dock) this.replaceDock(dock.edge, insertAtEdge(dock.root, instanceId, OPENING_SPLIT));
    else this.addDock(OPENING_EDGE, leafNode(instanceId));
  }

  /** Brings the sheet an instance is in to the front; anywhere else it already shows. */
  private raise(instanceId: string): void {
    const frame = this.frameOf(instanceId);
    if (frame?.layer !== "sheet") return;
    const sheet = this.sheets.find((entry) => entry.sheetId === frame.sheetId);
    if (!sheet || this.sheets.at(-1)?.sheetId === sheet.sheetId) return;
    this.sheets = [...this.sheets.filter((entry) => entry.sheetId !== sheet.sheetId), sheet];
  }

  /**
   * Whether dragging the instance may carry it into the frame. A drawer pane
   * stays in the drawer and a sheet pane on its sheet; a docked pane goes
   * anywhere but onto a sheet it is not already on.
   */
  canDragInto(instanceId: string, target: PaneFrame): boolean {
    const instance = this.instance(instanceId);
    const source = this.frameOf(instanceId);
    if (!instance || !source) return false;
    if (sameFrame(source, target)) return true;
    const presentation = this.presentationOf(instance.paneId);
    if (presentation === "drawer") return target.layer === "drawer";
    if (presentation === "sheet") return false;
    return target.layer !== "sheet" && source.layer !== "sheet";
  }

  /** Dismisses a sheet: every pane on it closes with it. */
  closeSheet(sheetId: string): void {
    const root = this.rootOf({ layer: "sheet", sheetId });
    if (!root) return;
    for (const instanceId of listLeaves(root)) this.closeInstance(instanceId);
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
    const frame = this.frameOf(instanceId);
    const root = frame && this.rootOf(frame);
    this.openPanes = this.openPanes.filter((entry) => entry.instanceId !== instanceId);
    if (frame && root) this.replaceRoot(frame, removeLeaf(root, instanceId));
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

  /** The drawer's width, kept inside what the board can spare. */
  setDrawerSize(size: number): void {
    if (!this.drawer) return;
    this.drawer = { ...this.drawer, size: clampDockSize("right", size, this.bounds) };
  }

  setSplitSizes(frame: PaneFrame, path: NodePath, sizes: number[]): void {
    const root = this.rootOf(frame);
    if (root) this.replaceRoot(frame, setSizes(root, path, sizes));
  }

  /**
   * Makes the instance a sibling of another one, on the given side of it — in
   * whichever tree that one is, so a pane attached to a chat joins the drawer.
   */
  attach(instanceId: string, targetInstanceId: string, edge: PaneEdge): void {
    const target = this.frameOf(targetInstanceId);
    if (!target || instanceId === targetInstanceId) return;
    this.move(instanceId, target, (root) => insertBeside(root, instanceId, targetInstanceId, edge));
  }

  /**
   * Docks the instance against an edge of the area, splitting whatever is already
   * there along the dock's own axis. A pane that is the whole of the dock it is
   * dropped back onto stays where it is.
   */
  attachToEdge(instanceId: string, edge: PaneEdge): void {
    const source = this.frameOf(instanceId);
    const sourceRoot = source && this.rootOf(source);
    if (!source || !sourceRoot) return;
    const target: PaneFrame = { layer: "dock", edge };
    if (sameFrame(source, target) && listLeaves(sourceRoot).length < 2) return;

    const split = edge === "left" || edge === "right" ? "bottom" : "right";
    this.move(instanceId, target, (root) => insertAtEdge(root, instanceId, split));
  }

  /** Where a pane let go over the area lands: the edge it was nearest. */
  dropAt(instanceId: string, x: number, y: number): void {
    this.attachToEdge(instanceId, nearestEdge(x, y, this.bounds));
  }

  /** Moves the instance to a dock of its own, on the first edge that has none. */
  detach(instanceId: string): void {
    const source = this.frameOf(instanceId);
    const sourceRoot = source && this.rootOf(source);
    if (!sourceRoot || listLeaves(sourceRoot).length < 2) return;
    const free = EDGE_ORDER.find((edge) => this.dock(edge) === undefined);
    if (free) this.attachToEdge(instanceId, free);
  }

  private move(instanceId: string, target: PaneFrame, insert: (root: PaneNode) => PaneNode): void {
    const source = this.frameOf(instanceId);
    const current = source && this.rootOf(source);
    if (!source || !current) return;

    const sourceRoot = removeLeaf(current, instanceId);
    if (sameFrame(source, target)) {
      // Rearranging inside one tree: the tree the leaf goes back into is the one
      // it was just taken out of, not the stale root. A leaf that was the whole
      // tree has nowhere to go back into, and stays where it is.
      if (!sourceRoot) return;
      this.replaceRoot(target, insert(sourceRoot));
      this.focusedInstanceId = instanceId;
      return;
    }

    const targetRoot = this.rootOf(target);
    this.replaceRoot(source, sourceRoot);
    if (targetRoot) this.replaceRoot(target, insert(targetRoot));
    else this.addFrame(target, leafNode(instanceId));
    this.focusedInstanceId = instanceId;
  }

  /** A tree of null is a frame with nothing in it, which is no frame at all. */
  private replaceRoot(frame: PaneFrame, root: PaneNode | null): void {
    if (frame.layer === "dock") {
      this.replaceDock(frame.edge, root);
      return;
    }
    if (frame.layer === "drawer") {
      this.drawer = root && this.drawer ? { ...this.drawer, root } : null;
      return;
    }
    this.sheets = root
      ? this.sheets.map((sheet) => (sheet.sheetId === frame.sheetId ? { ...sheet, root } : sheet))
      : this.sheets.filter((sheet) => sheet.sheetId !== frame.sheetId);
  }

  private addFrame(frame: PaneFrame, root: PaneNode): void {
    if (frame.layer === "dock") {
      this.addDock(frame.edge, root);
      return;
    }
    if (frame.layer === "drawer") {
      this.drawer = { size: clampDockSize("right", DEFAULT_DOCK_SIZE, this.bounds), root };
      return;
    }
    this.sheets = [...this.sheets, { sheetId: frame.sheetId, root }];
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
    if (this.drawer) {
      this.drawer = { ...this.drawer, size: clampDockSize("right", this.drawer.size, bounds) };
    }
  }

  /** Plain values, not state proxies: this is what gets written to the board. */
  snapshotLayout(): PaneLayout {
    const layout: PaneLayout = { docks: this.docks, instances: this.openPanes };
    if (this.drawer) layout.drawer = this.drawer;
    if (this.sheets.length > 0) layout.sheets = this.sheets;
    return $state.snapshot(layout) as PaneLayout;
  }

  /**
   * Takes a stored layout as the current one. An instance whose pane no build
   * provides is dropped — a dock that could only render an error is worse than a
   * smaller layout — and the rest of the layout is kept. A pane stored in a dock
   * that now asks to be a drawer or a sheet is moved there.
   */
  restoreLayout(layout: PaneLayout | undefined): void {
    const provided = new Set(this.definitions.map((entry) => entry.id));
    const known = new Map(
      (layout?.instances ?? [])
        .filter((entry) => entry.paneId !== rootPaneId && provided.has(entry.paneId))
        .map((entry) => [entry.instanceId, entry]),
    );
    const presentation = (instanceId: string): PanePresentation => {
      const instance = known.get(instanceId);
      return instance ? this.presentationOf(instance.paneId) : "dock";
    };

    const placed = new Set<string>();
    /** Keeps a stored tree's leaves the frame may hold, and claims them. */
    const claim = (
      root: PaneNode,
      allows: (value: PanePresentation) => boolean,
    ): PaneNode | null => {
      const kept = retainLeaves(
        root,
        (instanceId) =>
          known.has(instanceId) && !placed.has(instanceId) && allows(presentation(instanceId)),
      );
      if (!kept) return null;
      for (const instanceId of listLeaves(kept)) placed.add(instanceId);
      return normalizeNode(kept);
    };

    const docks: PaneDock[] = [];
    for (const dock of layout?.docks ?? []) {
      if (docks.some((entry) => entry.edge === dock.edge)) continue;
      const root = claim(dock.root, (value) => value === "dock");
      if (!root) continue;
      docks.push({ edge: dock.edge, size: clampDockSize(dock.edge, dock.size, this.bounds), root });
    }

    // A drawer or a sheet also holds the docked panes attached to what it shows.
    const drawerRoot = layout?.drawer && claim(layout.drawer.root, (value) => value !== "sheet");
    const sheets: PaneSheet[] = [];
    for (const sheet of layout?.sheets ?? []) {
      const root = claim(sheet.root, (value) => value !== "drawer");
      if (root) sheets.push({ sheetId: sheet.sheetId, root });
    }

    this.docks = docks;
    this.drawer =
      layout?.drawer && drawerRoot
        ? { size: clampDockSize("right", layout.drawer.size, this.bounds), root: drawerRoot }
        : null;
    this.sheets = sheets;

    const moved = (layout?.docks ?? [])
      .flatMap((dock) => listLeaves(dock.root))
      .filter((instanceId) => known.has(instanceId) && !placed.has(instanceId));
    for (const instanceId of moved) {
      if (presentation(instanceId) === "dock") continue;
      this.place(instanceId, presentation(instanceId));
      placed.add(instanceId);
    }

    this.openPanes = [...placed].map((instanceId) => known.get(instanceId)!);
    this.focusFirst();
  }

  /** The front sheet holds the user until it is closed, so it is what has focus. */
  private focusFirst(): void {
    const frame = this.frames().at(-1);
    const root = frame && this.rootOf(frame);
    if (frame?.layer === "sheet" && root) {
      this.focusedInstanceId = listLeaves(root)[0] ?? null;
      return;
    }
    const dock = this.docks[0];
    const first = dock?.root ?? this.drawer?.root;
    this.focusedInstanceId = first ? (listLeaves(first)[0] ?? null) : null;
  }
}
