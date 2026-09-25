import type { Disposer } from "@nib-ui/kernel";
import type { CanvasPointerEvent, CanvasTool, Point, Rect } from "@nib-ui/ui-contracts";
import { Graphics } from "pixi.js";
import type { CanvasEngine } from "../CanvasEngine";
import { isDropSource, isDropTarget } from "../drop";
import {
  HANDLE_CURSORS,
  isHoverable,
  isPressable,
  isResizable,
  type ResizeHandle,
} from "../resize";
import { type SnapGuide, type SnapResult, snapToNeighbours } from "../snap";
import { isSpawnable, nearEdge, onPlus, PLUS, plusAnchor, type SpawnEdge } from "../spawn";
import { rectFromCorners, rectsIntersect, unionRects } from "../utils/geometry";
import { CARD_RADIUS, GUIDE, MARQUEE, SELECTION } from "../../theme";

const DRAG_THRESHOLD = 5;

/** A drag that lines up with nothing: no pull, and no lines to draw. */
const NO_SNAP: SnapResult = { x: 0, y: 0, guides: [] };

type State =
  | { kind: "idle" }
  | { kind: "pending"; targetId: string; screen: Point; additive: boolean }
  /** A plus button held: let go on the table, it asks a question of the card. */
  | { kind: "spawning"; sourceId: string; edge: SpawnEdge; anchor: Point; pointer: Point }
  | {
      kind: "dragging";
      screen: Point;
      origins: { id: string; x: number; y: number }[];
      /** The rectangle the dragged cards covered when the drag began; null for a kind with none. */
      bounds: Rect | null;
      history: Disposer;
      /** What the dragged cards are hovering over, for the host to interpret. */
      overId: string | null;
    }
  | { kind: "rubber"; anchor: Point; corner: Point }
  | { kind: "resizing"; targetId: string; handle: ResizeHandle; world: Point; history: Disposer };

/**
 * Click, drag, rubber-band and resize. It never mutates the board itself beyond
 * the engine API, so what a move means — a debounced board save, an undo entry —
 * is the store's business.
 */
export class SelectTool implements CanvasTool {
  readonly id = "select";
  private engine: CanvasEngine | null = null;
  private band: Graphics | null = null;
  /** The alignment lines a drag is holding, which the band is already busy outlining a drop with. */
  private guides: Graphics | null = null;
  private state: State = { kind: "idle" };
  /** The card whose plus button is showing: the one the pointer is near from outside. */
  private plusCardId: string | null = null;
  /** The card the pointer is on, which is the one drawing its resize grips. */
  private handleCardId: string | null = null;

  onAttach(engine: unknown): void {
    this.engine = engine as CanvasEngine;
    this.band = new Graphics();
    this.guides = new Graphics();
    this.engine.overlay.addChild(this.band, this.guides);
  }

  onDetach(): void {
    this.showPlus(null);
    this.showHandles(null);
    this.band?.destroy();
    this.band = null;
    this.guides?.destroy();
    this.guides = null;
    this.engine = null;
    this.state = { kind: "idle" };
  }

  onPointerDown(event: CanvasPointerEvent): boolean {
    const engine = this.engine;
    if (!engine) return false;

    const hitId = engine.hitTest(event.screen.x, event.screen.y);

    // The right button is the context menu and nothing else. The engine opens it
    // on release, so the gesture is refused here rather than claimed.
    if (event.button !== 0) return false;

    // A plus button sits outside the card, so the hit test never sees it; the
    // card showing its buttons is asked first, ahead of anything under the point.
    const plus = this.plusUnder(event.world);
    if (plus) {
      const bounds = engine.objectBounds(plus.id);
      const anchor = bounds ? plusAnchor(bounds, plus.edge, engine.camera.zoom) : event.world;
      this.state = {
        kind: "spawning",
        sourceId: plus.id,
        edge: plus.edge,
        anchor,
        pointer: anchor,
      };
      this.setCursor("grabbing");
      return true;
    }

    const additive = event.shiftKey || event.metaKey;

    // A grip is grabbed wherever it is drawn, and it is drawn on whatever the
    // pointer is over. Selecting the card first would cost a click to do what
    // the pointer is already on top of.
    const hitRenderer = hitId === null ? undefined : engine.rendererFor(hitId);
    if (hitId !== null && isResizable(hitRenderer)) {
      const handle = hitRenderer.handleAt(event.world.x, event.world.y);
      if (handle) {
        if (!engine.selection.includes(hitId)) engine.select([hitId]);
        const history = engine.beginHistory();
        hitRenderer.beginResize();
        this.state = { kind: "resizing", targetId: hitId, handle, world: event.world, history };
        this.setCursor(HANDLE_CURSORS[handle]);
        return true;
      }
    }

    if (!hitId) {
      if (!additive) {
        engine.select([]);
        // Clicking away is how a preview or a spread stack is put back, and it
        // happens on the press so the board is restored before the drag begins.
        engine.clearFocus();
      }
      this.state = { kind: "rubber", anchor: event.world, corner: event.world };
      return true;
    }

    // A press on something already multi-selected keeps the group so the whole
    // selection can be dragged; the click that follows narrows it instead.
    if (!engine.selection.includes(hitId))
      engine.select(additive ? [...engine.selection, hitId] : [hitId]);
    this.state = { kind: "pending", targetId: hitId, screen: event.screen, additive };
    return true;
  }

  onPointerMove(event: CanvasPointerEvent): void {
    const engine = this.engine;
    if (!engine) return;

    if (this.state.kind === "resizing") {
      const renderer = engine.rendererFor(this.state.targetId);
      if (isResizable(renderer)) {
        renderer.applyResize(
          this.state.handle,
          event.world.x - this.state.world.x,
          event.world.y - this.state.world.y,
          event.shiftKey,
        );
      }
      return;
    }

    if (this.state.kind === "spawning") {
      this.state = { ...this.state, pointer: event.world };
      this.drawTether();
      return;
    }

    if (this.state.kind === "pending") {
      const moved = Math.hypot(
        event.screen.x - this.state.screen.x,
        event.screen.y - this.state.screen.y,
      );
      if (moved <= DRAG_THRESHOLD) return;

      const ids = engine.selection.includes(this.state.targetId)
        ? engine.selection
        : [this.state.targetId];
      const origins = ids
        .map((id) => engine.objects.find((object) => object.id === id))
        .filter((object) => typeof object?.x === "number" && typeof object.y === "number")
        .map((object) => ({ id: object!.id, x: object!.x as number, y: object!.y as number }));
      const boxes = origins
        .map((origin) => engine.objectBounds(origin.id))
        .filter((bounds): bounds is Rect => bounds !== null);
      this.state = {
        kind: "dragging",
        screen: this.state.screen,
        origins,
        bounds: unionRects(boxes),
        history: engine.beginHistory(),
        overId: null,
      };
      const lifted = this.state.origins.map((origin) => origin.id);
      this.setRaised(lifted, true);
      // After the origins are read, never before: putting the folder or the pile
      // away moves what is left, and the drag has to start from where the cards
      // were picked up.
      engine.beginDrag(lifted);
    }

    if (this.state.kind === "dragging") {
      const deltaX = (event.screen.x - this.state.screen.x) / engine.camera.zoom;
      const deltaY = (event.screen.y - this.state.screen.y) / engine.camera.zoom;
      // The cards being dragged are under the pointer themselves, so the target is
      // the topmost one that is not part of the drag.
      const dragged = new Set(this.state.origins.map((origin) => origin.id));
      const snap = this.snapDrag(this.state.bounds, deltaX, deltaY, dragged, event.altKey);
      this.drawGuides(snap.guides);
      const snapX = deltaX + snap.x;
      const snapY = deltaY + snap.y;
      for (const origin of this.state.origins) {
        engine.updateObject(origin.id, { x: origin.x + snapX, y: origin.y + snapY });
      }
      this.state = {
        ...this.state,
        overId: engine.hitTestExcluding(event.screen.x, event.screen.y, dragged),
      };
      // Only a card that would do something with the drop is outlined, and only
      // then does the dragged card shrink towards it.
      const target = this.dropTarget(this.state.overId);
      this.drawDropTarget(target);
      for (const origin of this.state.origins) {
        const renderer = engine.rendererFor(origin.id);
        if (isDropSource(renderer)) renderer.previewDrop(target);
      }
      return;
    }

    if (this.state.kind === "rubber") {
      this.state = { ...this.state, corner: event.world };
      this.drawBand();
      engine.select(
        engine.objectsIntersecting(rectFromCorners(this.state.anchor, this.state.corner)),
      );
      return;
    }

    this.trackHoverTargets(event.world, event.screen);
  }

  onPointerUp(event: CanvasPointerEvent): void {
    const engine = this.engine;
    const state = this.state;
    this.state = { kind: "idle" };

    switch (state.kind) {
      case "resizing": {
        const renderer = engine?.rendererFor(state.targetId);
        if (isResizable(renderer)) renderer.endResize();
        state.history();
        this.setCursor("");
        return;
      }
      case "spawning": {
        this.band?.clear();
        this.setCursor("");
        // A click on the button, never dragged, asks the question right there
        // beside the card; a drag asks it where the button was let go.
        engine?.spawnFrom(state.sourceId, event.world);
        return;
      }
      case "dragging": {
        this.band?.clear();
        this.guides?.clear();
        const ids = state.origins.map((origin) => origin.id);
        this.setRaised(ids, false);
        // Dropped into a folder, the card goes into it rather than vanishing from
        // where it was let go: the move that follows is what takes it off the board.
        const target = this.dropTarget(state.overId);
        for (const id of ids) {
          const renderer = engine?.rendererFor(id);
          if (!isDropSource(renderer)) continue;
          if (target) renderer.swallowInto(target);
          else renderer.previewDrop(null);
        }
        // The drop is reported before the history entry closes, so the `mv` it may
        // start and the positions it left behind are one step (PLAN §13).
        engine?.dropOnto(ids, state.overId, event.world);
        state.history();
        return;
      }
      case "rubber":
        this.band?.clear();
        return;
      case "pending": {
        // A press that never moved is a click: it narrows a group selection and,
        // without a modifier, opens what was pressed.
        if (state.additive) {
          const selection = engine?.selection ?? [];
          engine?.select(
            selection.includes(state.targetId)
              ? selection.filter((id) => id !== state.targetId)
              : [...selection, state.targetId],
          );
          return;
        }
        engine?.select([state.targetId]);

        // Chrome drawn inside a card answers the click first — Allow, a file row,
        // the link a bookmark stands for. It is read on the way up rather than on
        // the way down so that dragging the card never triggers it.
        const target = engine?.rendererFor(state.targetId);
        if (isPressable(target) && target.pressAt(event.world.x, event.world.y)) return;
        if (event.button === 0) engine?.activate(state.targetId, "click");
        return;
      }
      case "idle":
        return;
    }
  }

  /**
   * Resize handles are drawn on the card the pointer is over, selected or not,
   * and on the selection so a card being resized keeps its grips while the
   * pointer runs off it.
   */
  private trackHoverTargets(world: Point, screen: Point): void {
    const engine = this.engine;
    if (!engine) return;

    const over = engine.hitTest(screen.x, screen.y);
    this.showHandles(over);

    let cursor = "";
    const targets = new Set(engine.selection);
    if (over !== null) targets.add(over);
    for (const id of targets) {
      const renderer = engine.rendererFor(id);
      if (!isResizable(renderer)) continue;
      const handle = renderer.handleAt(world.x, world.y);
      renderer.hoverHandle(handle, renderer.hitTest?.(world.x, world.y) ?? false);
      if (handle) cursor = HANDLE_CURSORS[handle];
    }

    // Chrome drawn inside the card lights up under the pointer and is pressed
    // rather than dragged, so it takes the cursor off whatever else wanted it.
    const hoverTarget = over === null ? undefined : engine.rendererFor(over);
    if (isHoverable(hoverTarget) && hoverTarget.hoverAt(world)) cursor = "pointer";

    // The plus button shows on the edge the pointer is near from outside — over
    // a card the pointer is looking at it, not asking about it — and nothing
    // shows while the pointer is on some other card.
    const near = over === null ? this.cardNear(world) : null;
    this.showPlus(near?.id ?? null);
    if (near) {
      const renderer = engine.rendererFor(near.id);
      if (isSpawnable(renderer)) renderer.hoverPlus(near.edge, near.hot);
      if (near.hot && cursor.length === 0) cursor = "grab";
    }

    this.setCursor(cursor);
  }

  /**
   * The topmost card that can be started from and that the pointer is near,
   * with the edge it is near and whether it is on the button itself.
   */
  private cardNear(world: Point): { id: string; edge: SpawnEdge; hot: boolean } | null {
    const engine = this.engine;
    if (!engine) return null;
    const zoom = engine.camera.zoom;
    const objects = engine.objects;
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const id = objects[index]?.id;
      if (id === undefined || !isSpawnable(engine.rendererFor(id))) continue;
      const bounds = engine.objectBounds(id);
      if (!bounds) continue;
      const local = { x: world.x - bounds.x, y: world.y - bounds.y };
      const edge = nearEdge(local.x, local.y, bounds.width, bounds.height, zoom);
      if (!edge) continue;
      return { id, edge, hot: onPlus(local.x, local.y, edge, bounds.width, bounds.height, zoom) };
    }
    return null;
  }

  /** The button under a world point on the card that is showing one. */
  private plusUnder(world: Point): { id: string; edge: SpawnEdge } | null {
    const id = this.plusCardId;
    if (id === null) return null;
    const renderer = this.engine?.rendererFor(id);
    if (!isSpawnable(renderer)) return null;
    const edge = renderer.plusAt(world.x, world.y);
    return edge === null ? null : { id, edge };
  }

  /**
   * The card whose grips are showing because the pointer is on it. The one it
   * replaces has to be told, or a card left behind keeps the bars it was drawn
   * with — the loop below only reaches the cards the pointer is on now.
   */
  private showHandles(id: string | null): void {
    const previousId = this.handleCardId;
    if (id === previousId) return;
    this.handleCardId = id;
    if (previousId === null) return;

    const previous = this.engine?.rendererFor(previousId);
    if (isResizable(previous)) previous.hoverHandle(null, false);
    if (isHoverable(previous)) previous.hoverAt(null);
  }

  private showPlus(id: string | null): void {
    if (id === this.plusCardId) return;
    const previous =
      this.plusCardId === null ? undefined : this.engine?.rendererFor(this.plusCardId);
    if (isSpawnable(previous)) previous.hoverPlus(null, false);
    this.plusCardId = id;
  }

  /** A line from the button to the pointer, with a disc at its end: the question travelling. */
  private drawTether(): void {
    const engine = this.engine;
    const band = this.band;
    if (!engine || !band || this.state.kind !== "spawning") return;

    const zoom = Math.max(0.2, engine.camera.zoom);
    const { anchor, pointer } = this.state;
    band.clear();
    band.moveTo(anchor.x, anchor.y).lineTo(pointer.x, pointer.y);
    band.stroke({ width: 1.5 / zoom, color: PLUS.ring });
    band.circle(pointer.x, pointer.y, PLUS.radius / zoom);
    band.fill({ color: PLUS.fill });
    band.circle(pointer.x, pointer.y, PLUS.radius / zoom);
    band.stroke({ width: 1 / zoom, color: PLUS.ring });
  }

  /**
   * The rectangle of what is under the drag, when letting go there would mean
   * something. A card that takes no drops is not a target: outlining it would
   * promise a move, and the drop would leave the dragged card where it was.
   */
  private dropTarget(overId: string | null): Rect | null {
    const engine = this.engine;
    if (!engine || overId === null) return null;
    const renderer = engine.rendererFor(overId);
    if (!isDropTarget(renderer) || !renderer.acceptsDrop()) return null;
    return engine.objectBounds(overId);
  }

  /** Outlines the topic a drop would land in, and nothing when there is none. */
  private drawDropTarget(bounds: Rect | null): void {
    const engine = this.engine;
    const band = this.band;
    if (!engine || !band) return;

    band.clear();
    if (!bounds) return;

    // On the object's own edge, the same as the selection ring. The hover band and
    // the ring that replaces it on click have to trace the same rectangle, or the
    // outline jumps outwards the moment the card is selected.
    const zoom = Math.max(0.2, engine.camera.zoom);
    band.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, CARD_RADIUS);
    const width = Math.min(SELECTION.ringWidth / zoom, Math.min(bounds.width, bounds.height) / 12);
    band.stroke({ width, color: SELECTION.handleColor });
  }

  /**
   * Where the drag wants to land, read off the cards already placed. The
   * rectangle offered is the one the dragged cards covered when the gesture
   * began, moved by the drag so far: snapping the group as a whole is what keeps
   * a multi-card drag rigid.
   */
  private snapDrag(
    bounds: Rect | null,
    deltaX: number,
    deltaY: number,
    dragged: ReadonlySet<string>,
    disabled: boolean,
  ): SnapResult {
    const engine = this.engine;
    if (!engine || !bounds || disabled) return NO_SNAP;

    return snapToNeighbours(
      { ...bounds, x: bounds.x + deltaX, y: bounds.y + deltaY },
      this.neighbourBounds(dragged),
      GUIDE.tolerance / Math.max(0.2, engine.camera.zoom),
    );
  }

  /**
   * The rectangles a drag aligns against: everything placed that is not being
   * dragged and is on screen. A card off screen is left out because the guide
   * drawn for it would run to somewhere the board is not showing, which reads as
   * the card having been pulled by nothing.
   */
  private neighbourBounds(dragged: ReadonlySet<string>): Rect[] {
    const engine = this.engine;
    if (!engine) return [];

    const topLeft = engine.screenToWorld(0, 0);
    const view = {
      x: topLeft.x,
      y: topLeft.y,
      width: engine.screenWidth / engine.camera.zoom,
      height: engine.screenHeight / engine.camera.zoom,
    };

    const rects: Rect[] = [];
    for (const object of engine.objects) {
      if (dragged.has(object.id)) continue;
      const bounds = engine.objectBounds(object.id);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
      if (!rectsIntersect(bounds, view)) continue;
      rects.push(bounds);
    }
    return rects;
  }

  /**
   * The lines the drag is held by, drawn through the cards they join and a little
   * past them. In the camera-transformed overlay like the band, so the stroke is
   * divided by the zoom to stay a hairline on screen.
   */
  private drawGuides(guides: readonly SnapGuide[]): void {
    const engine = this.engine;
    const graphics = this.guides;
    if (!engine || !graphics) return;

    graphics.clear();
    if (guides.length === 0) return;

    const zoom = Math.max(0.2, engine.camera.zoom);
    const overhang = GUIDE.overhang / zoom;
    for (const guide of guides) {
      if (guide.axis === "x") {
        graphics
          .moveTo(guide.position, guide.from - overhang)
          .lineTo(guide.position, guide.to + overhang);
        continue;
      }
      graphics
        .moveTo(guide.from - overhang, guide.position)
        .lineTo(guide.to + overhang, guide.position);
    }
    graphics.stroke({
      width: GUIDE.strokeWidth / zoom,
      color: GUIDE.stroke,
      alpha: GUIDE.strokeAlpha,
    });
  }

  private setCursor(cursor: string): void {
    const canvas = this.engine?.app.canvas as HTMLCanvasElement | undefined;
    if (canvas) canvas.style.cursor = cursor;
  }

  /**
   * A one-pixel grey stroke over a faint white wash, with square corners. The
   * band lives in the camera-transformed overlay, so its stroke width is divided
   * by the zoom to stay one pixel on screen however far out the board is.
   */
  private drawBand(): void {
    const engine = this.engine;
    const band = this.band;
    if (!engine || !band || this.state.kind !== "rubber") return;

    const rect = rectFromCorners(this.state.anchor, this.state.corner);
    const zoom = engine.camera.zoom;

    band.clear();
    band.rect(rect.x, rect.y, rect.width, rect.height);
    band.fill({ color: MARQUEE.fill, alpha: MARQUEE.fillAlpha });
    band.rect(rect.x, rect.y, rect.width, rect.height);
    band.stroke({ width: MARQUEE.strokeWidth / zoom, color: MARQUEE.stroke });
  }

  /**
   * Cards being dragged are lifted off the table, which is the only cue that the
   * gesture is a move rather than a press. Reported to the renderers rather than
   * inferred by them: only the tool knows a drag is running.
   */
  private setRaised(ids: readonly string[], raised: boolean): void {
    const engine = this.engine;
    if (!engine) return;
    for (const id of ids) {
      const renderer = engine.rendererFor(id);
      if (isRaisable(renderer)) renderer.setRaised(raised);
    }
  }
}

/** Opted into by a card that draws a stronger shadow while it is off the table. */
interface RaisableRenderer {
  setRaised(raised: boolean): void;
}

function isRaisable(renderer: unknown): renderer is RaisableRenderer {
  return typeof (renderer as Partial<RaisableRenderer> | undefined)?.setRaised === "function";
}
