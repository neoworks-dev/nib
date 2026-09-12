import type { Disposer } from "@nib-ui/kernel";
import type {
  ActivationGesture,
  CanvasCamera,
  CanvasContextProvider,
  CanvasDropHandler,
  CanvasDropPayload,
  CanvasLayer,
  CanvasMenuItem,
  CanvasMenuProvider,
  CanvasObject,
  CanvasObjectContext,
  CanvasObjectKind,
  CanvasPasteHandler,
  CanvasPastePayload,
  CanvasRegistry,
  CanvasTool,
  Point,
} from "@nib-ui/ui-contracts";
import type { BoardStore } from "./board.svelte";
import { activateObject, byOrder, dispatch } from "./dispatch";
import type { CanvasEngine } from "./engine/CanvasEngine";
import type { EngineHost } from "./engine/types";
import { clampZoom, screenToWorld, worldToScreen } from "./engine/utils/camera";

export interface OpenMenu {
  items: CanvasMenuItem[];
  /** Canvas-element coordinates: the menu is DOM, drawn over the Pixi surface. */
  x: number;
  y: number;
}

/**
 * The `canvas` service. It holds what plugins contribute and what a window is
 * looking at, and outlives any mounted engine — closing the board pane must not
 * cost a plugin its registrations.
 */
export class CanvasRegistryStore implements CanvasRegistry, EngineHost {
  camera = $state<CanvasCamera>({ x: 0, y: 0, zoom: 1 });
  selection = $state<string[]>([]);
  activeTool = $state("select");
  menu = $state<OpenMenu | null>(null);
  engine = $state<CanvasEngine | null>(null);

  /** Set by the plugin: what opening an object means is not the engine's business. */
  onActivate: ((object: CanvasObject) => void) | null = null;
  /** A double click on empty board space: what it creates is the plugin's call. */
  onCreateAt: ((at: Point) => void) | null = null;
  /** A click away from everything: whatever had the focus gives it up. */
  onClearFocus: (() => void) | null = null;
  /**
   * Where the focus set comes from. Set by the plugin, because what counts as
   * focused — a previewed folder and its contents, a spread stack and its
   * members — is not a fact the board itself knows.
   */
  focusSource: (() => ReadonlySet<string> | null) | null = null;
  /** Cards released over a card, or over empty board space: a `mv`, or nothing. */
  onDropOnto: ((ids: string[], toId: string | null, at: Point) => void) | null = null;
  /** Set by the plugin: entering a project is a board load plus everything that hangs off it. */
  onOpenBoard: ((cwd: string) => Promise<void>) | null = null;
  /** Set by the plugin: opening a workstream is a pane operation the registry knows nothing about. */
  onOpenWorkstream: ((workstreamId: string) => void) | null = null;

  private readonly kinds = new Map<string, CanvasObjectKind>();
  private readonly toolSet = new Set<CanvasTool>();
  private readonly pasteHandlers = new Set<CanvasPasteHandler>();
  private readonly dropHandlers = new Set<CanvasDropHandler>();
  private readonly menuProviders = new Set<CanvasMenuProvider>();
  private readonly contextProviders = new Set<CanvasContextProvider>();
  private readonly layerSet = new Set<CanvasLayer>();
  /** Bumped on every registration so the engine's tick picks the change up. */
  private revision = $state(0);

  constructor(private readonly board: BoardStore) {}

  registerKind(kind: CanvasObjectKind): Disposer {
    if (this.kinds.has(kind.kind))
      throw new Error(`canvas kind "${kind.kind}" is already registered`);
    this.kinds.set(kind.kind, kind);
    this.revision += 1;
    return () => {
      this.kinds.delete(kind.kind);
      this.revision += 1;
    };
  }

  registerTool(tool: CanvasTool): Disposer {
    this.toolSet.add(tool);
    this.revision += 1;
    return () => {
      this.toolSet.delete(tool);
      if (this.activeTool === tool.id) this.setTool("select");
      this.revision += 1;
    };
  }

  registerPasteHandler(handler: CanvasPasteHandler): Disposer {
    this.pasteHandlers.add(handler);
    return () => void this.pasteHandlers.delete(handler);
  }

  registerDropHandler(handler: CanvasDropHandler): Disposer {
    this.dropHandlers.add(handler);
    return () => void this.dropHandlers.delete(handler);
  }

  registerContextMenu(provider: CanvasMenuProvider): Disposer {
    this.menuProviders.add(provider);
    return () => void this.menuProviders.delete(provider);
  }

  registerContextProvider(provider: CanvasContextProvider): Disposer {
    this.contextProviders.add(provider);
    return () => void this.contextProviders.delete(provider);
  }

  /**
   * The first provider that owns the kind answers; the rest are not asked. An
   * object none of them claims still names itself, so anything a plugin puts on
   * the board can be carried into a task — a link is a relation, not a thing.
   */
  contextFor(object: CanvasObject): CanvasObjectContext | null {
    for (const provider of byOrder(this.contextProviders)) {
      const context = provider.contextFor(object);
      if (context) return context;
    }
    return object.kind === "edge" ? null : { label: describeObject(object) };
  }

  registerLayer(layer: CanvasLayer): Disposer {
    this.layerSet.add(layer);
    this.revision += 1;
    return () => {
      this.layerSet.delete(layer);
      layer.container.parent?.removeChild(layer.container);
      this.revision += 1;
    };
  }

  get objects(): CanvasObject[] {
    return this.board.objects;
  }

  get tools(): CanvasTool[] {
    this.revision;
    return [...this.toolSet];
  }

  get layers(): CanvasLayer[] {
    this.revision;
    return [...this.layerSet];
  }

  kindFor(kind: string): CanvasObjectKind | undefined {
    this.revision;
    return this.kinds.get(kind);
  }

  get cwd(): string {
    return this.board.cwd;
  }

  async openBoard(cwd: string): Promise<void> {
    await this.onOpenBoard?.(cwd);
  }

  /** The board comes up first: a workstream cannot be opened out of a board that is not loaded. */
  async openWorkstream(cwd: string, workstreamId: string): Promise<void> {
    await this.openBoard(cwd);
    this.onOpenWorkstream?.(workstreamId);
  }

  addObject(object: CanvasObject): void {
    this.board.addObject(object);
  }

  updateObject(id: string, patch: Partial<CanvasObject>): void {
    this.board.updateObject(id, patch);
  }

  removeObjects(ids: string[]): void {
    this.board.removeObjects(ids);
    this.selection = this.selection.filter((id) => !ids.includes(id));
  }

  select(ids: string[]): void {
    if (
      ids.length === this.selection.length &&
      ids.every((id, index) => this.selection[index] === id)
    )
      return;
    this.selection = ids;
  }

  setTool(toolId: string): void {
    this.activeTool = toolId;
    this.engine?.setTool(toolId);
  }

  setCamera(camera: CanvasCamera): void {
    this.camera = { ...camera, zoom: clampZoom(camera.zoom) };
  }

  screenToWorld(x: number, y: number): Point {
    return screenToWorld(x, y, this.camera);
  }

  worldToScreen(x: number, y: number): Point {
    return worldToScreen(x, y, this.camera);
  }

  beginHistory(): Disposer {
    return this.board.beginHistory();
  }

  undo(): void {
    this.board.undo();
  }

  redo(): void {
    this.board.redo();
  }

  activate(id: string, gesture: ActivationGesture = "click"): void {
    const object = this.board.find(id);
    if (object) activateObject(this.kindFor(object.kind), object, this.onActivate, gesture);
  }

  get focus(): ReadonlySet<string> | null {
    return this.focusSource?.() ?? null;
  }

  createAt(at: Point): void {
    this.onCreateAt?.(at);
  }

  clearFocus(): void {
    this.onClearFocus?.();
  }

  dropOnto(ids: string[], toId: string | null, at: Point): void {
    if (ids.length > 0) this.onDropOnto?.(ids, toId, at);
  }

  contextMenu(target: CanvasObject | null, at: Point, screen: Point): void {
    const items = byOrder(this.menuProviders).flatMap((provider) => provider.items(target, at));
    this.menu = items.length > 0 ? { items, x: screen.x, y: screen.y } : null;
  }

  closeMenu(): void {
    this.menu = null;
  }

  /** Ordered, first claim wins; a disposed handler is simply no longer in the set. */
  paste(payload: CanvasPastePayload, at: Point): Promise<boolean> {
    return dispatch(this.pasteHandlers, payload, at);
  }

  drop(payload: CanvasDropPayload, at: Point): Promise<boolean> {
    return dispatch(this.dropHandlers, payload, at);
  }

  reset(): void {
    this.kinds.clear();
    this.toolSet.clear();
    this.pasteHandlers.clear();
    this.dropHandlers.clear();
    this.menuProviders.clear();
    this.contextProviders.clear();
    this.layerSet.clear();
    this.selection = [];
    this.menu = null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.activeTool = "select";
    this.engine = null;
    this.focusSource = null;
    this.onActivate = null;
    this.onCreateAt = null;
    this.onClearFocus = null;
    this.onDropOnto = null;
  }
}

/**
 * What to call an object whose plugin does not say. Board objects are open
 * records, so the fields a card is likely to be named by are read off in the
 * order a person would read them, and the kind is the answer of last resort.
 */
function describeObject(object: CanvasObject): string {
  for (const field of ["title", "name", "label", "url", "path"]) {
    const value = object[field];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return object.kind;
}
