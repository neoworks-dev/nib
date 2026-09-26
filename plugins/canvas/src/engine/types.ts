import type { Disposer } from "@nib-ui/kernel";
import type {
  ActivationGesture,
  CanvasCamera,
  CanvasLayer,
  CanvasObject,
  CanvasObjectKind,
  CanvasTool,
  Point,
} from "@nib-ui/ui-contracts";

/**
 * What the engine is given instead of muse's module-level state singletons. The
 * board store implements it, so the drawing code never learns where objects are
 * persisted or how a session is opened.
 */
export interface EngineHost {
  readonly objects: CanvasObject[];
  readonly selection: string[];
  readonly camera: CanvasCamera;
  readonly layers: CanvasLayer[];
  readonly tools: CanvasTool[];
  readonly activeTool: string;

  kindFor(kind: string): CanvasObjectKind | undefined;
  setCamera(camera: CanvasCamera): void;
  select(ids: string[]): void;
  addObject(object: CanvasObject): void;
  updateObject(id: string, patch: Partial<CanvasObject>): void;
  removeObjects(ids: string[]): void;
  /** Groups every mutation until the disposer runs into one undo step. */
  beginHistory(): Disposer;
  undo(): void;
  redo(): void;
  setTool(toolId: string): void;

  /**
   * What is drawn at full strength while something has the focus, or null while
   * nothing does. Focus dims the rest of the board instead of navigating away
   * from it: everything stays exactly where it was, which is the whole point.
   */
  readonly focus: ReadonlySet<string> | null;

  /** A click that was not a drag, or a double-click: open the object pressed. */
  activate(id: string, gesture: ActivationGesture): void;
  /** A double click on empty board space, which is how a sticky is made. */
  createAt(at: Point): void;
  /** A click on empty board space that was not a drag: whatever had focus loses it. */
  clearFocus(): void;
  /**
   * A left-button drag of `ids` released over `toId`, or over empty board space.
   * The tool reports only the gesture: for a vault card it is a real `mv` into
   * that topic's directory (PLAN §5), and for everything else it is nothing.
   */
  dropOnto(ids: string[], toId: string | null, at: Point): void;
  /**
   * A drag of `ids` has passed the threshold and is about to move them. What
   * they were being shown as part of — a folder laid open, a pile spread out —
   * is put away here, so the drag crosses a board that is not still covered by
   * the block the cards came out of.
   */
  beginDrag(ids: string[]): void;
  /**
   * A drag of `ids` has left the board through its top edge. On a topic raised
   * as a sheet that edge is the board it sits on: the host goes back there and
   * the cards come along. True when it did, so the tool carries on the drag
   * across the board that is on screen now.
   */
  carryOut(ids: string[]): boolean;
  contextMenu(target: CanvasObject | null, at: Point, screen: Point): void;
  /**
   * A plus button dragged off a card and let go at `at`: the host asks what to
   * do with the object there, which is how a task is started from a picture.
   */
  spawnFrom(id: string, at: Point): void;
}
