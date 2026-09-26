import type { Disposer } from "@nib-ui/kernel";
import type {
  ActivationGesture,
  CanvasCamera,
  CanvasEngineApi,
  CanvasObject,
  CanvasObjectRenderer,
  CanvasPointerEvent,
  CanvasTool,
  Point,
  Rect,
} from "@nib-ui/ui-contracts";
import { Application, Container, Graphics } from "pixi.js";
import type { EngineHost } from "./types";
import { clampZoom, screenToWorld, worldToScreen, zoomAt } from "./utils/camera";
import { pointInRect, rectsIntersect } from "./utils/geometry";
import { configureAssetRoot } from "./utils/texture";
import { TextTextureCache } from "./utils/textTexture";
import { DIMMED_ALPHA } from "../theme";

/** Screen pixels a right button travels before the press counts as a drag. */
const RIGHT_DRAG_THRESHOLD = 5;
/** Shared so the plain hit test does not allocate a set per pointer move. */
const EMPTY_SET: ReadonlySet<string> = new Set();
/** Screen pixels of board kept live outside the camera, so nothing pops in. */
const CULL_MARGIN = 256;
/** Assumed extent of a placed object that does not say how big it is. */
const DEFAULT_CULL_SIZE = 320;
/** Chrome fires the middle-button paste after the button is released. */
const MIDDLE_PASTE_GRACE_MS = 300;
/** Per-frame approach to the focus alpha: about 150ms to settle at 60fps. */
const DIM_EASE = 0.18;

export interface EngineTheme {
  background: number;
}

const defaultTheme: EngineTheme = { background: 0xe9eaee };

interface RendererEntry {
  kind: string;
  renderer: CanvasObjectRenderer;
  /** Whether `sync` has run, which is when the container's position means anything. */
  synced: boolean;
}

/**
 * Owns the Pixi application, the camera and the input plumbing. Everything it
 * draws comes from registered kinds, and every gesture it recognises is handed
 * to the active tool — it has no opinion about what a board object means.
 */
export class CanvasEngine implements CanvasEngineApi {
  app!: Application;
  /** Camera-transformed root. Layers, objects and tool overlays all live under it. */
  world!: Container;
  objectLayer!: Container;
  /** World-space scratch container for tools — rubber bands, resize handles. */
  overlay!: Container;
  readonly textures = new TextTextureCache();

  private readonly renderers = new Map<string, RendererEntry>();
  /** Renderers animating out, still drawn and still reclaimable by their own id. */
  private readonly exiting = new Map<string, RendererEntry>();
  private attachedTool: CanvasTool | null = null;
  private readonly pointers = new Map<number, Point>();
  private pinch: { distance: number; zoom: number; world: Point } | null = null;
  private middlePan: { pointerId: number; screen: Point; camera: CanvasCamera } | null = null;
  /** A right button that is down, and whether it has travelled far enough to be a drag. */
  private rightPress: { pointerId: number; screen: Point; moved: boolean } | null = null;
  private middlePanEndedAt = -Infinity;
  private disposers: Disposer[] = [];
  /** Where the pointer last was, in world units, for gestures with no event of their own. */
  private lastPointer: Point = { x: 0, y: 0 };
  /**
   * The table's own colour laid over everything that does not have the focus,
   * rather than an alpha on each card. A translucent card is translucent all the
   * way through: its panel stops hiding what is behind it, so a dimmed folder
   * showed the papers inside it through its own front, and every card showed
   * whatever it was sitting on top of.
   */
  private readonly scrim = new Graphics();
  /** How far the board is dimmed: 0 at full strength, 1 at the scrim's own. */
  private dim = 0;

  constructor(
    private readonly host: EngineHost,
    private readonly theme: () => EngineTheme = () => defaultTheme,
  ) {}

  /** Re-read after a theme change: the canvas cannot inherit CSS variables. */
  applyTheme(): void {
    if (!this.app) return;
    this.app.renderer.background.color = this.theme().background;
  }

  async init(element: HTMLElement): Promise<void> {
    configureAssetRoot();
    this.app = new Application();
    await this.app.init({
      resizeTo: element,
      background: this.theme().background,
      antialias: true,
      resolution: globalThis.devicePixelRatio || 1,
      autoDensity: true,
    });

    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.style.touchAction = "none";
    canvas.style.display = "block";
    element.appendChild(canvas);

    this.world = new Container();
    this.world.sortableChildren = true;
    this.objectLayer = new Container();
    this.objectLayer.sortableChildren = true;
    this.scrim.eventMode = "none";
    this.scrim.visible = false;
    this.objectLayer.addChild(this.scrim);
    this.overlay = new Container();
    this.overlay.zIndex = 10_000;
    this.overlay.eventMode = "none";
    this.world.addChild(this.objectLayer, this.overlay);
    this.app.stage.addChild(this.world);

    this.app.ticker.add(this.tick);
    this.bindInput(canvas);
    this.followSize(element);
    this.setTool(this.host.activeTool);
  }

  /**
   * `resizeTo` only listens to the window, and the board's box changes without
   * the window doing so: a dock opening beside it, a folder's sheet lowering it.
   */
  private followSize(element: HTMLElement): void {
    const observer = new ResizeObserver(() => this.app.queueResize());
    observer.observe(element);
    this.disposers.push(() => observer.disconnect());
  }

  /** The board as it is drawn right now, as an image url. */
  capture(): string {
    this.app.render();
    return (this.app.canvas as HTMLCanvasElement).toDataURL("image/jpeg", 0.85);
  }

  destroy(): void {
    this.attachedTool?.onDetach?.();
    this.attachedTool = null;
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const entry of this.renderers.values()) entry.renderer.destroy?.();
    for (const entry of this.exiting.values()) entry.renderer.destroy?.();
    this.renderers.clear();
    this.exiting.clear();
    this.textures.clear();
    this.app?.ticker.remove(this.tick);
    this.app?.destroy(true, { children: true });
  }

  get screenWidth(): number {
    return this.app?.screen.width ?? 0;
  }

  get screenHeight(): number {
    return this.app?.screen.height ?? 0;
  }

  get camera(): CanvasCamera {
    return this.host.camera;
  }

  get objects(): CanvasObject[] {
    return this.host.objects;
  }

  get selection(): string[] {
    return this.host.selection;
  }

  addObject(object: CanvasObject): void {
    this.host.addObject(object);
  }

  updateObject(id: string, patch: Partial<CanvasObject>): void {
    this.host.updateObject(id, patch);
  }

  removeObjects(ids: string[]): void {
    this.host.removeObjects(ids);
  }

  select(ids: string[]): void {
    this.host.select(ids);
  }

  beginHistory(): Disposer {
    return this.host.beginHistory();
  }

  /** A click or double-click: what "open" means is the host's decision. */
  activate(id: string, gesture: ActivationGesture): void {
    this.host.activate(id, gesture);
  }

  clearFocus(): void {
    this.host.clearFocus();
  }

  dropOnto(ids: string[], toId: string | null, at: Point): void {
    this.host.dropOnto(ids, toId, at);
  }

  beginDrag(ids: string[]): void {
    this.host.beginDrag(ids);
  }

  carryOut(ids: string[]): boolean {
    return this.host.carryOut(ids);
  }

  spawnFrom(id: string, at: Point): void {
    this.host.spawnFrom(id, at);
  }

  setTool(toolId: string): void {
    const next = this.host.tools.find((tool) => tool.id === toolId) ?? null;
    if (next === this.attachedTool) return;
    this.attachedTool?.onDetach?.();
    this.attachedTool = next;
    this.attachedTool?.onAttach?.(this);
    const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
    if (canvas) canvas.style.cursor = next?.cursor ?? "";
  }

  /**
   * The pointer's last world position. A keyboard shortcut has no event to read
   * one from, and "the card nearest the cursor ends up on top" needs one.
   */
  get pointerWorld(): Point {
    return this.lastPointer;
  }

  screenToWorld(x: number, y: number): Point {
    return screenToWorld(x, y, this.camera);
  }

  worldToScreen(x: number, y: number): Point {
    return worldToScreen(x, y, this.camera);
  }

  rendererFor(id: string): CanvasObjectRenderer | undefined {
    return this.renderers.get(id)?.renderer;
  }

  objectBounds(id: string): Rect | null {
    return this.renderers.get(id)?.renderer.bounds() ?? null;
  }

  /** Topmost object under a point in canvas-element coordinates. */
  hitTest(screenX: number, screenY: number): string | null {
    return this.hitTestExcluding(screenX, screenY, EMPTY_SET);
  }

  /**
   * The same walk with some objects taken out of it. A drag needs this: the cards
   * being dragged sit under the pointer themselves, and what matters is what they
   * are being dropped on.
   */
  hitTestExcluding(screenX: number, screenY: number, skip: ReadonlySet<string>): string | null {
    const world = this.screenToWorld(screenX, screenY);
    const objects = this.objects;

    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const object = objects[index]!;
      if (skip.has(object.id)) continue;
      const entry = this.renderers.get(object.id);
      if (!entry) continue;
      if (entry.renderer.hitTest) {
        if (entry.renderer.hitTest(world.x, world.y)) return object.id;
        continue;
      }
      const bounds = entry.renderer.bounds();
      const padding = this.host.kindFor(object.kind)?.hitPadding ?? 0;
      if (bounds && pointInRect(world.x, world.y, bounds, padding)) return object.id;
    }
    return null;
  }

  /** Every object whose bounds meet a world rectangle — the rubber band's job. */
  objectsIntersecting(rect: Rect): string[] {
    const ids: string[] = [];
    for (const object of this.objects) {
      const bounds = this.renderers.get(object.id)?.renderer.bounds();
      if (bounds && rectsIntersect(bounds, rect)) ids.push(object.id);
    }
    return ids;
  }

  private tick = (): void => {
    this.syncLayers();
    this.syncObjects();
    this.syncCamera();
  };

  /** Plugin layers are re-parented rather than tracked: registering one is rare. */
  private syncLayers(): void {
    for (const layer of this.host.layers) {
      if (layer.container.parent === this.world) continue;
      layer.container.zIndex = layer.order ?? 0;
      this.world.addChild(layer.container);
    }
    this.objectLayer.zIndex = 0;
  }

  private syncObjects(): void {
    const objects = this.objects;
    const live = new Set(objects.map((object) => object.id));

    for (const [id, entry] of this.renderers) {
      // A kind that was unregistered mid-session leaves its objects on the board
      // but takes its renderer with it, so the type change counts as a removal.
      if (live.has(id) && this.host.kindFor(entry.kind)) continue;
      this.renderers.delete(id);
      const renderer = entry.renderer;
      if (!renderer.exit) {
        this.discard(entry);
        continue;
      }
      // Under everything still on the board, because it is on its way off: a card
      // going back into a folder goes under the folder's front panel, and the
      // lift it had while it was open is not its any more.
      renderer.container.zIndex = -1;
      // Kept rather than forgotten while it animates out, so an object that comes
      // back before it has gone is the same object: a folder closed and re-opened
      // mid-flight takes its cards back rather than drawing a second set of them.
      this.exiting.set(id, entry);
      renderer.exit(() => {
        if (this.exiting.get(id) !== entry) return;
        this.exiting.delete(id);
        this.discard(entry);
      });
    }

    const selection = this.selection;
    const focus = this.host.focus;
    const view = this.visibleWorldRect();
    objects.forEach((object, index) => {
      const kind = this.host.kindFor(object.kind);
      if (!kind) return;
      const parsed = kind.parse(object);
      if (!parsed) return;

      let entry = this.renderers.get(object.id);
      if (!entry) {
        entry = this.revive(object.id, object.kind);
        if (!entry) {
          entry = { kind: object.kind, renderer: kind.createRenderer(this), synced: false };
          this.objectLayer.addChild(entry.renderer.container);
          entry.renderer.spawn?.();
        }
        this.renderers.set(object.id, entry);
      }
      // Board order is z-order, so a dragged card can be brought to the front.
      // What has the focus is lifted over the scrim, which is what dims the rest.
      const lifted = focus !== null && focus.has(object.id);
      entry.renderer.container.zIndex = lifted ? objects.length + 1 + index : index;

      // `sync` runs per object per frame, so a board with a hundred cards pays for
      // all of them whether or not any are on screen. An object that declares its
      // own rectangle and sits outside the camera is hidden and skipped; anything
      // without one — an edge, which is wherever its endpoints are — is not, and
      // neither is anything selected, whose chrome has to keep following the zoom.
      // A card is where it is drawn as well as where it is going: one easing
      // towards a place off screen has to keep moving until it is out of view,
      // not vanish the moment its target is.
      const box = worldBox(object);
      const container = entry.renderer.container;
      const drawn =
        box !== null && entry.synced ? { ...box, x: container.x, y: container.y } : null;
      const offscreen =
        box !== null &&
        !rectsIntersect(box, view) &&
        !(drawn !== null && rectsIntersect(drawn, view)) &&
        !selection.includes(object.id);
      container.visible = !offscreen;
      if (offscreen) return;
      entry.renderer.sync(parsed, selection);
      entry.synced = true;
    });
    this.syncScrim(focus !== null, objects.length);
  }

  /**
   * An object that is back before it finished leaving, taken off the exit and
   * handed back whole. A renderer of the wrong kind cannot be reused, and cannot
   * be left on the way out either — the id is about to belong to another one — so
   * it goes at once.
   */
  private revive(id: string, kind: string): RendererEntry | undefined {
    const entry = this.exiting.get(id);
    if (!entry) return undefined;
    this.exiting.delete(id);
    if (entry.kind !== kind) {
      this.discard(entry);
      return undefined;
    }
    entry.renderer.cancelExit?.();
    return entry;
  }

  private discard(entry: RendererEntry): void {
    entry.renderer.container.parent?.removeChild(entry.renderer.container);
    entry.renderer.destroy?.();
  }

  /**
   * Eases the table's colour over everything that does not have the focus. One
   * sheet under the focused cards rather than an alpha on each of the others:
   * every card stays exactly where it was, which is why clicking a folder reads
   * as looking closer rather than as navigating, and nothing goes see-through.
   */
  private syncScrim(focused: boolean, count: number): void {
    const target = focused ? 1 - DIMMED_ALPHA : 0;
    if (Math.abs(target - this.dim) < 0.005) this.dim = target;
    else this.dim += (target - this.dim) * DIM_EASE;

    this.scrim.visible = this.dim > 0;
    if (!this.scrim.visible) return;

    const view = this.visibleWorldRect();
    this.scrim.zIndex = count;
    this.scrim.alpha = this.dim;
    this.scrim.clear().rect(view.x, view.y, view.width, view.height).fill(this.theme().background);
  }

  /**
   * The camera's rectangle in world space, grown by a margin so a card entering
   * from the edge is already drawn by the time any of it shows.
   */
  private visibleWorldRect(): Rect {
    const { zoom } = this.camera;
    const topLeft = this.screenToWorld(-CULL_MARGIN, -CULL_MARGIN);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: (this.screenWidth + CULL_MARGIN * 2) / zoom,
      height: (this.screenHeight + CULL_MARGIN * 2) / zoom,
    };
  }

  private syncCamera(): void {
    const { x, y, zoom } = this.camera;
    this.world.position.set(x, y);
    this.world.scale.set(zoom);
  }

  private toCanvasPoint(event: PointerEvent | WheelEvent | MouseEvent): Point {
    const rect = (this.app.canvas as HTMLCanvasElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private toolEvent(event: PointerEvent): CanvasPointerEvent {
    const screen = this.toCanvasPoint(event);
    return {
      native: event,
      screen,
      world: this.screenToWorld(screen.x, screen.y),
      button: event.button,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      pressure: event.pressure,
      pointerType: event.pointerType,
    };
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, handler as EventListener, options);
      this.disposers.push(() =>
        canvas.removeEventListener(type, handler as EventListener, options),
      );
    };

    // The middle button pans. On X11 it is also primary-selection paste, and on
    // every platform it is autoscroll, so the legacy mouse events have to be
    // refused as well — `pointerdown` alone does not suppress either.
    listen("mousedown", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    listen("auxclick", (event) => {
      if (event.button === 1) event.preventDefault();
    });

    listen("pointerdown", (event) => {
      // A pointer the browser no longer knows cannot be captured, and it throws
      // rather than saying so. The gesture then simply runs uncaptured.
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* empty */
      }
      if (event.button === 1) {
        event.preventDefault();
        this.middlePan = {
          pointerId: event.pointerId,
          screen: this.toCanvasPoint(event),
          camera: { ...this.camera },
        };
        canvas.style.cursor = "grabbing";
        return;
      }
      if (event.button === 2) {
        this.rightPress = {
          pointerId: event.pointerId,
          screen: this.toCanvasPoint(event),
          moved: false,
        };
        this.attachedTool?.onPointerDown?.(this.toolEvent(event));
        return;
      }

      this.pointers.set(event.pointerId, this.toCanvasPoint(event));
      if (this.pointers.size === 2) {
        this.startPinch();
        return;
      }
      this.attachedTool?.onPointerDown?.(this.toolEvent(event));
    });

    listen("pointermove", (event) => {
      const at = this.toCanvasPoint(event);
      this.lastPointer = this.screenToWorld(at.x, at.y);
      if (this.middlePan?.pointerId === event.pointerId) {
        const screen = this.toCanvasPoint(event);
        this.host.setCamera({
          ...this.middlePan.camera,
          x: this.middlePan.camera.x + (screen.x - this.middlePan.screen.x),
          y: this.middlePan.camera.y + (screen.y - this.middlePan.screen.y),
        });
        return;
      }
      if (this.rightPress?.pointerId === event.pointerId) {
        const screen = this.toCanvasPoint(event);
        const travelled = Math.hypot(
          screen.x - this.rightPress.screen.x,
          screen.y - this.rightPress.screen.y,
        );
        if (travelled > RIGHT_DRAG_THRESHOLD) this.rightPress.moved = true;
        this.attachedTool?.onPointerMove?.(this.toolEvent(event));
        return;
      }
      if (this.pointers.has(event.pointerId)) {
        this.pointers.set(event.pointerId, this.toCanvasPoint(event));
        if (this.pointers.size === 2) {
          this.updatePinch();
          return;
        }
      }
      this.attachedTool?.onPointerMove?.(this.toolEvent(event));
    });

    const release = (event: PointerEvent, cancelled = false) => {
      if (this.middlePan?.pointerId === event.pointerId) {
        this.middlePan = null;
        this.middlePanEndedAt = performance.now();
        canvas.style.cursor = this.attachedTool?.cursor ?? "";
        return;
      }
      if (this.rightPress?.pointerId === event.pointerId) {
        const dragged = this.rightPress.moved;
        this.rightPress = null;
        this.attachedTool?.onPointerUp?.(this.toolEvent(event));
        // A right button that never travelled is a click, and a click is the menu.
        if (!dragged && !cancelled) this.openContextMenu(this.toCanvasPoint(event));
        return;
      }
      this.pointers.delete(event.pointerId);
      this.pinch = null;
      this.attachedTool?.onPointerUp?.(this.toolEvent(event));
    };
    listen("pointerup", release);
    listen("pointercancel", (event) => release(event, true));

    listen(
      "wheel",
      (event) => {
        event.preventDefault();
        const at = this.toCanvasPoint(event);
        // Trackpad two-finger scrolling pans; pinch arrives as ctrl+wheel, and
        // a mouse wheel is only ever a zoom because the board has no scrollbars.
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          event.deltaMode === 0 &&
          Math.abs(event.deltaX) > 0
        ) {
          this.host.setCamera({
            ...this.camera,
            x: this.camera.x - event.deltaX,
            y: this.camera.y - event.deltaY,
          });
          return;
        }
        this.host.setCamera(
          zoomAt(at.x, at.y, this.camera.zoom * Math.exp(-event.deltaY * 0.0015), this.camera),
        );
      },
      { passive: false },
    );

    // The menu is opened on release instead, because the right button also drags:
    // the native event fires on press on X11 and on release everywhere else, and
    // a gesture cannot be told from a click until the button comes back up.
    listen("contextmenu", (event) => event.preventDefault());

    listen("dblclick", (event) => {
      const screen = this.toCanvasPoint(event);
      const hitId = this.hitTest(screen.x, screen.y);
      if (hitId) {
        this.host.activate(hitId, "doubleClick");
        return;
      }
      this.host.createAt(this.screenToWorld(screen.x, screen.y));
    });

    // X11 pastes the primary selection on the middle button, and Chrome dispatches
    // that at whatever has focus — the drawer's composer, or the board's own paste
    // handler — however the mouse events over the canvas were answered. Panning
    // must not type, so the paste itself is refused for the length of the gesture.
    const refusePaste = (event: ClipboardEvent) => {
      if (!this.middlePan && performance.now() - this.middlePanEndedAt > MIDDLE_PASTE_GRACE_MS)
        return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("paste", refusePaste, true);
    this.disposers.push(() => window.removeEventListener("paste", refusePaste, true));

    const onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
    window.addEventListener("keydown", onKeyDown);
    this.disposers.push(() => window.removeEventListener("keydown", onKeyDown));
  }

  private openContextMenu(screen: Point): void {
    const hitId = this.hitTest(screen.x, screen.y);
    const target = hitId ? (this.objects.find((object) => object.id === hitId) ?? null) : null;
    this.host.contextMenu(target, this.screenToWorld(screen.x, screen.y), screen);
  }

  /** Board shortcuts stay out of the way of the drawer's composer and any text field. */
  private handleKeyDown(event: KeyboardEvent): void {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) {
      const tag = active.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || active.isContentEditable) return;
    }
    if (this.attachedTool?.onKeyDown?.(event)) return;

    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.host.redo();
      else this.host.undo();
      return;
    }
    if (event.key === "Escape") {
      this.host.select([]);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      const ids = [...this.selection];
      if (ids.length === 0) return;
      event.preventDefault();
      this.host.removeObjects(ids);
    }
  }

  private startPinch(): void {
    const [first, second] = [...this.pointers.values()];
    if (!first || !second) return;
    const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    this.pinch = {
      distance: Math.hypot(first.x - second.x, first.y - second.y) || 1,
      zoom: this.camera.zoom,
      world: this.screenToWorld(middle.x, middle.y),
    };
  }

  private updatePinch(): void {
    if (!this.pinch) {
      this.startPinch();
      return;
    }
    const [first, second] = [...this.pointers.values()];
    if (!first || !second) return;
    const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const zoom = clampZoom(
      this.pinch.zoom * (Math.hypot(first.x - second.x, first.y - second.y) / this.pinch.distance),
    );
    this.host.setCamera({
      zoom,
      x: middle.x - this.pinch.world.x * zoom,
      y: middle.y - this.pinch.world.y * zoom,
    });
  }
}

/**
 * An object's own rectangle, read off the fields every placed kind writes, or
 * null for a kind that has none. Taken from the object rather than from its
 * renderer so that culling never has to sync the thing it is deciding to skip —
 * an unsynced renderer has no bounds yet, which would make every card visible on
 * its first frame and defeat the whole exercise.
 */
function worldBox(object: CanvasObject): Rect | null {
  const { x, y, w, h } = object;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const width = typeof w === "number" && Number.isFinite(w) ? w : DEFAULT_CULL_SIZE;
  const height = typeof h === "number" && Number.isFinite(h) ? h : DEFAULT_CULL_SIZE;
  return { x, y, width, height };
}
