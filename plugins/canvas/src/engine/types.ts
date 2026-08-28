import type { Disposer } from '@nib-ui/kernel';
import type {
	ActivationGesture,
	CanvasCamera,
	CanvasLayer,
	CanvasObject,
	CanvasObjectKind,
	CanvasTool,
	Point,
} from '@nib-ui/ui-contracts';

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

	/** A click that was not a drag, or a double-click: open the object pressed. */
	activate(id: string, gesture: ActivationGesture): void;
	/** A connector dragged out of a port and released; `toId` is null on empty space. */
	connect(fromId: string, toId: string | null, at: Point): void;
	/** A right-button drag out of a selection; `toId` is null on empty space. */
	spawn(sourceIds: string[], toId: string | null, at: Point): void;
	contextMenu(target: CanvasObject | null, at: Point, screen: Point): void;
}
