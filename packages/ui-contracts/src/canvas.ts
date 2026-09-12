import type { Disposer } from "@nib-ui/kernel";
import type { MessageAttachment } from "@nib-ui/protocol";
import type { PlacementMap, StackMap } from "@nib-ui/vault";
import type { Application, Container } from "pixi.js";
import type { PaneLayout } from "./panes";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasCamera {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Board objects are stored opaquely. The board JSON is hand-editable and outlives
 * the plugin set that wrote it, so an object whose kind no loaded plugin claims
 * still round-trips instead of being dropped. Typing happens in `CanvasObjectKind.parse`.
 */
export interface CanvasObject {
  kind: string;
  id: string;
  [key: string]: unknown;
}

/**
 * A workstream as the board index reports it: what the board itself stores,
 * without the live session state a card folds in. Whoever reads the index joins
 * it against the session summaries to learn what the workstream is doing now.
 */
export interface BoardWorkstream {
  id: string;
  goal: string;
  sessionId: string | null;
  /** When the user last marked the workstream read; absent while it still wants attention. */
  reviewedAt: number | null;
}

/** One entry of the board index: a project directory and the workstreams on its board. */
export interface BoardSummary {
  cwd: string;
  workstreams: BoardWorkstream[];
  /** Newest board revision, so a caller can tell an untouched board from a busy one. */
  rev: number;
}

/** One board per working directory. `rev` guards a stale window's write. */
export interface BoardDoc {
  version: 1;
  rev: number;
  cwd: string;
  objects: CanvasObject[];
  /**
   * Where the vault's items sit, by board directory and then by vault-relative
   * path. Item identity and content come from the vault on disk; this is the only
   * part of a board that is the app's own.
   */
  placements: PlacementMap;
  /**
   * Where each pile sits, by stack id. Beside the placements rather than inside
   * them because a stack outlives any one member: the pile stays put while items
   * are dragged out of it, and an id is unique across the document.
   */
  stacks: StackMap;
  /** Where the panes of this workspace were floating. Absent until one is opened. */
  layout?: PaneLayout;
}

export function emptyBoard(cwd: string): BoardDoc {
  return { version: 1, rev: 0, cwd, objects: [], placements: {}, stacks: {} };
}

/**
 * What a window sends back. `placements` and `stacks` are optional here and only
 * here: a build that predates them sends a document without them, and the stored
 * maps have to survive that rather than be deleted by an older window.
 */
export type BoardWrite = Omit<BoardDoc, "placements" | "stacks"> & {
  placements?: PlacementMap;
  stacks?: StackMap;
};

export interface CanvasObjectRenderer<TData extends CanvasObject = CanvasObject> {
  readonly container: Container;
  /** Called every frame with the latest data. Should be cheap. */
  sync(data: TData, selection: string[]): void;
  /** World-space bounding box, for hit tests and the rubber band. */
  bounds(): Rect | null;
  /** Overrides the bounds test — strokes and edges are not rectangles. */
  hitTest?(worldX: number, worldY: number): boolean;
  spawn?(): void;
  /** Animate out, then call `done`. Without it the container is removed at once. */
  exit?(done: () => void): void;
  destroy?(): void;
}

export interface CanvasObjectKind<TData extends CanvasObject = CanvasObject> {
  kind: string;
  /** Defensive load — board JSON is hand-editable and versioned. */
  parse(raw: unknown): TData | null;
  createRenderer(engine: CanvasEngineApi): CanvasObjectRenderer<TData>;
  /** Extra world-space padding for hit tests, for thin objects like strokes. */
  hitPadding?: number;
  /**
   * A single click or a double click on the object. The kind that owns it decides
   * what each gesture means, and claims both outright: the board's own handler is
   * reached only for a kind with no hook.
   */
  activate?(object: TData, gesture: ActivationGesture): void;
}

/** A click that was not a drag, and the double-click that may follow it. */
export type ActivationGesture = "click" | "doubleClick";

export interface CanvasPointerEvent {
  native: PointerEvent;
  /** Relative to the canvas element, not the viewport. */
  screen: Point;
  world: Point;
  button: number;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  pressure: number;
  pointerType: string;
}

export interface CanvasTool {
  id: string;
  cursor?: string;
  onAttach?(engine: CanvasEngineApi): void;
  onDetach?(): void;
  /** True claims the gesture: the engine stops offering it to anything else. */
  onPointerDown?(event: CanvasPointerEvent): boolean;
  onPointerMove?(event: CanvasPointerEvent): void;
  onPointerUp?(event: CanvasPointerEvent): void;
  onKeyDown?(event: KeyboardEvent): boolean;
}

export interface CanvasPastePayload {
  text?: string;
  html?: string;
  files: File[];
}

/** First handler that claims the payload wins; ordered by `order`, default 0. */
export interface CanvasPasteHandler {
  order?: number;
  handle(payload: CanvasPastePayload, at: Point): boolean | Promise<boolean>;
}

/**
 * A file a session already has on disk, dragged out of a pane rather than in
 * from the desktop. Only the reference travels: whoever claims it stores the
 * bytes from the workspace, so a large file never crosses the browser at all.
 */
export interface WorkspaceFileRef {
  sessionId: string;
  /** Workspace-relative, as the session's own tools name it. */
  path: string;
}

/** Drag data type carrying `WorkspaceFileRef[]` as JSON. */
export const workspaceFileTransferType = "application/x-nib-workspace-file";

export function parseWorkspaceFileRefs(raw: string): WorkspaceFileRef[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is WorkspaceFileRef =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as WorkspaceFileRef).sessionId === "string" &&
        typeof (entry as WorkspaceFileRef).path === "string" &&
        (entry as WorkspaceFileRef).path.length > 0,
    );
  } catch {
    return [];
  }
}

export interface CanvasDropPayload {
  files: File[];
  text?: string;
  uri?: string;
  /** Dropped out of another pane; the bytes are still in the session's workspace. */
  workspaceFiles?: WorkspaceFileRef[];
}

export interface CanvasDropHandler {
  order?: number;
  handle(payload: CanvasDropPayload, at: Point): boolean | Promise<boolean>;
}

export type CanvasMenuItem =
  | { kind: "action"; id: string; label: string; run(): void | Promise<void> }
  | { kind: "separator"; id: string };

export interface CanvasMenuProvider {
  order?: number;
  /** `target` is null when the menu was opened on empty board space. */
  items(target: CanvasObject | null, at: Point): CanvasMenuItem[];
}

/**
 * What an object hands a workstream that carries it: files for the harness to
 * look at or open, and a name for the chat to show. A picture on the board is
 * context for the task it is linked to, and this is how it travels there.
 */
export interface CanvasObjectContext {
  label: string;
  attachments?: MessageAttachment[];
  /**
   * What the object is, in the prompt's own terms — a url, a caption, a path.
   * A bookmark has nothing to attach and everything to say; a picture is the
   * other way round, and most objects are worth a line either way.
   */
  text?: string;
}

/**
 * Answers what one kind of object contributes as context. The board itself knows
 * only workstreams and links: what a media card or a model is worth to a prompt
 * is answered by the plugin that put it there.
 */
export interface CanvasContextProvider {
  order?: number;
  /** Null for an object this provider does not own. */
  contextFor(object: CanvasObject): CanvasObjectContext | null;
}

/** Extra Pixi container above or below the object layer — marquees, badges, HUD. */
export interface CanvasLayer {
  id: string;
  container: Container;
  /** Negative draws below the objects, positive above. Default 0. */
  order?: number;
}

/** What renderers and tools are handed: the camera, hit testing, and mutation. */
export interface CanvasEngineApi {
  readonly app: Application;
  readonly camera: CanvasCamera;
  readonly objects: CanvasObject[];
  readonly selection: string[];
  screenToWorld(x: number, y: number): Point;
  worldToScreen(x: number, y: number): Point;
  /** Topmost object under a point in canvas-element coordinates. */
  hitTest(screenX: number, screenY: number): string | null;
  objectBounds(id: string): Rect | null;
  addObject(object: CanvasObject): void;
  updateObject(id: string, patch: Partial<CanvasObject>): void;
  removeObjects(ids: string[]): void;
  select(ids: string[]): void;
  setTool(toolId: string): void;
  /** Groups every mutation until the returned disposer runs into one undo step. */
  beginHistory(): Disposer;
}

/**
 * The service plugins talk to. It outlives any mounted engine — the board pane
 * can be closed — so the camera and hit tests fall back to identity while no
 * engine is attached, and registrations survive to be replayed onto the next one.
 */
export interface CanvasRegistry {
  registerKind(kind: CanvasObjectKind): Disposer;
  registerTool(tool: CanvasTool): Disposer;
  registerPasteHandler(handler: CanvasPasteHandler): Disposer;
  registerDropHandler(handler: CanvasDropHandler): Disposer;
  registerContextMenu(provider: CanvasMenuProvider): Disposer;
  registerContextProvider(provider: CanvasContextProvider): Disposer;
  registerLayer(layer: CanvasLayer): Disposer;

  /** What an object is worth to a task that carries it, or null for one that is worth nothing. */
  contextFor(object: CanvasObject): CanvasObjectContext | null;

  readonly objects: CanvasObject[];
  readonly selection: string[];
  readonly camera: CanvasCamera;
  readonly activeTool: string;
  /** Directory whose board is on screen; empty until one is opened. */
  readonly cwd: string;
  /**
   * Shows the board of a directory, with no task of its own. This is how a
   * project is entered: the board is the project, so opening one is opening it.
   */
  openBoard(cwd: string): Promise<void>;
  /** Brings the workstream's board up and opens its transcript. */
  openWorkstream(cwd: string, workstreamId: string): Promise<void>;
  addObject(object: CanvasObject): void;
  updateObject(id: string, patch: Partial<CanvasObject>): void;
  removeObjects(ids: string[]): void;
  select(ids: string[]): void;
  setTool(toolId: string): void;
  screenToWorld(x: number, y: number): Point;
  worldToScreen(x: number, y: number): Point;
  undo(): void;
  redo(): void;
}
