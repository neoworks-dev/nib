import type { Disposer } from "@nib-ui/kernel";
import type { CanvasPointerEvent, CanvasTool, Point, Rect } from "@nib-ui/ui-contracts";
import { Graphics } from "pixi.js";
import type { CanvasEngine } from "../CanvasEngine";
import { isConnectable } from "../ports";
import { HANDLE_CURSORS, isPressable, isResizable, type ResizeHandle } from "../resize";
import { edgePoint, rectFromCorners } from "../utils/geometry";

const DRAG_THRESHOLD = 5;

type State =
  | { kind: "idle" }
  | { kind: "pending"; targetId: string; screen: Point; additive: boolean }
  | {
      kind: "dragging";
      screen: Point;
      origins: { id: string; x: number; y: number }[];
      history: Disposer;
    }
  | { kind: "rubber"; anchor: Point; corner: Point }
  | { kind: "resizing"; targetId: string; handle: ResizeHandle; world: Point; history: Disposer }
  | { kind: "connecting"; fromId: string; anchor: Point; pointer: Point; overId: string | null }
  | {
      kind: "spawning";
      sourceIds: string[];
      screen: Point;
      pointer: Point;
      overId: string | null;
      moved: boolean;
    };

/**
 * Click, drag, rubber-band and resize. It never mutates the board itself beyond
 * the engine API, so what a move means — a debounced board save, an undo entry —
 * is the store's business.
 */
export class SelectTool implements CanvasTool {
  readonly id = "select";
  private engine: CanvasEngine | null = null;
  private band: Graphics | null = null;
  private state: State = { kind: "idle" };

  onAttach(engine: unknown): void {
    this.engine = engine as CanvasEngine;
    this.band = new Graphics();
    this.engine.overlay.addChild(this.band);
  }

  onDetach(): void {
    this.band?.destroy();
    this.band = null;
    this.engine = null;
    this.state = { kind: "idle" };
  }

  onPointerDown(event: CanvasPointerEvent): boolean {
    const engine = this.engine;
    if (!engine) return false;

    const hitId = engine.hitTest(event.screen.x, event.screen.y);

    // The right button drags a new task out of what is selected. On empty space it
    // is left alone: an unmoved right button is the context menu, which the engine
    // opens for both cases when the gesture turns out not to be a drag.
    if (event.button === 2) {
      if (!hitId) return false;
      const selected = engine.selection.includes(hitId);
      if (!selected) engine.select([hitId]);
      this.state = {
        kind: "spawning",
        sourceIds: selected ? [...engine.selection] : [hitId],
        screen: event.screen,
        pointer: event.world,
        overId: null,
        moved: false,
      };
      return true;
    }
    if (event.button !== 0) return false;

    const additive = event.shiftKey || event.metaKey;

    // A port answers before anything else, selected or not: it is the only
    // affordance that hangs outside the object it belongs to.
    if (hitId && !additive) {
      const renderer = engine.rendererFor(hitId);
      const port = isConnectable(renderer) ? renderer.portAt(event.world.x, event.world.y) : null;
      if (port && isConnectable(renderer)) {
        this.state = {
          kind: "connecting",
          fromId: hitId,
          anchor: renderer.portAnchor(port),
          pointer: event.world,
          overId: null,
        };
        this.setCursor("crosshair");
        return true;
      }
    }

    if (hitId && engine.selection.includes(hitId)) {
      const renderer = engine.rendererFor(hitId);
      const handle = isResizable(renderer) ? renderer.handleAt(event.world.x, event.world.y) : null;
      if (handle && isResizable(renderer)) {
        const history = engine.beginHistory();
        renderer.beginResize();
        this.state = { kind: "resizing", targetId: hitId, handle, world: event.world, history };
        this.setCursor(HANDLE_CURSORS[handle]);
        return true;
      }
    }

    if (!hitId) {
      if (!additive) engine.select([]);
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

    if (this.state.kind === "connecting") {
      const overId = engine.hitTest(event.screen.x, event.screen.y);
      this.state = {
        ...this.state,
        pointer: event.world,
        overId: overId && overId !== this.state.fromId ? overId : null,
      };
      this.drawLinks([this.state.anchor], this.state.pointer, this.state.overId);
      return;
    }

    if (this.state.kind === "spawning") {
      const overId = engine.hitTest(event.screen.x, event.screen.y);
      const travelled = Math.hypot(
        event.screen.x - this.state.screen.x,
        event.screen.y - this.state.screen.y,
      );
      this.state = {
        ...this.state,
        pointer: event.world,
        overId: overId && !this.state.sourceIds.includes(overId) ? overId : null,
        moved: this.state.moved || travelled > DRAG_THRESHOLD,
      };
      if (this.state.moved) {
        this.setCursor("crosshair");
        this.drawLinks(
          this.spawnAnchors(this.state.sourceIds, event.world),
          event.world,
          this.state.overId,
        );
      }
      return;
    }

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
      this.state = {
        kind: "dragging",
        screen: this.state.screen,
        origins,
        history: engine.beginHistory(),
      };
    }

    if (this.state.kind === "dragging") {
      const deltaX = (event.screen.x - this.state.screen.x) / engine.camera.zoom;
      const deltaY = (event.screen.y - this.state.screen.y) / engine.camera.zoom;
      for (const origin of this.state.origins) {
        engine.updateObject(origin.id, { x: origin.x + deltaX, y: origin.y + deltaY });
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

    this.trackHoverTargets(event.world);
  }

  onPointerUp(event: CanvasPointerEvent): void {
    const engine = this.engine;
    const state = this.state;
    this.state = { kind: "idle" };

    switch (state.kind) {
      case "spawning": {
        this.band?.clear();
        this.setCursor("");
        // An unmoved right button is the context menu, which the engine opens.
        if (state.moved) engine?.spawn(state.sourceIds, state.overId, event.world);
        return;
      }
      case "connecting": {
        this.band?.clear();
        this.setCursor("");
        const targetId = engine?.hitTest(event.screen.x, event.screen.y) ?? null;
        engine?.connect(
          state.fromId,
          targetId && targetId !== state.fromId ? targetId : null,
          event.world,
        );
        return;
      }
      case "resizing": {
        const renderer = engine?.rendererFor(state.targetId);
        if (isResizable(renderer)) renderer.endResize();
        state.history();
        this.setCursor("");
        return;
      }
      case "dragging":
        state.history();
        return;
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
   * Resize handles belong to the selection; a port belongs to whatever the
   * pointer is over, so the two are tracked against different sets.
   */
  private trackHoverTargets(world: Point): void {
    const engine = this.engine;
    if (!engine) return;

    let cursor = "";
    for (const id of engine.selection) {
      const renderer = engine.rendererFor(id);
      if (!isResizable(renderer)) continue;
      const handle = renderer.handleAt(world.x, world.y);
      renderer.hoverHandle(handle);
      if (handle) cursor = HANDLE_CURSORS[handle];
    }

    for (const object of engine.objects) {
      const renderer = engine.rendererFor(object.id);
      if (!isConnectable(renderer)) continue;
      const port = renderer.portAt(world.x, world.y);
      renderer.hoverPort(port);
      if (port) cursor = "crosshair";
    }

    this.setCursor(cursor);
  }

  /** Where each source's connector leaves it: the edge facing the pointer. */
  private spawnAnchors(sourceIds: string[], toward: Point): Point[] {
    const engine = this.engine;
    if (!engine) return [];
    return sourceIds
      .map((id) => engine.objectBounds(id))
      .filter((bounds): bounds is Rect => bounds !== null)
      .map((bounds) => edgePoint(bounds, toward));
  }

  /**
   * The dragged connectors, drawn in the same world-space overlay as the rubber
   * band. A filled endpoint means it will land on the card under the pointer;
   * a hollow one means it will open a new workstream there.
   */
  private drawLinks(anchors: Point[], pointer: Point, overId: string | null): void {
    const engine = this.engine;
    const band = this.band;
    if (!engine || !band) return;

    const zoom = engine.camera.zoom;
    band.clear();

    for (const anchor of anchors) {
      band.moveTo(anchor.x, anchor.y);
      band.lineTo(pointer.x, pointer.y);
    }
    band.stroke({ width: 1.75 / zoom, color: 0x7c9cff, alpha: 0.85, cap: "round" });

    band.circle(pointer.x, pointer.y, 4.5 / zoom);
    if (overId) band.fill({ color: 0x7c9cff, alpha: 0.9 });
    else band.stroke({ width: 1.75 / zoom, color: 0x7c9cff, alpha: 0.85 });

    const bounds = overId ? engine.objectBounds(overId) : null;
    if (!bounds) return;
    const inset = 3 / zoom;
    band.roundRect(
      bounds.x - inset,
      bounds.y - inset,
      bounds.width + inset * 2,
      bounds.height + inset * 2,
      12 + inset,
    );
    band.stroke({ width: 1.75 / zoom, color: 0x7c9cff, alpha: 0.85 });
  }

  private setCursor(cursor: string): void {
    const canvas = this.engine?.app.canvas as HTMLCanvasElement | undefined;
    if (canvas) canvas.style.cursor = cursor;
  }

  /**
   * The band lives in the camera-transformed overlay, so its stroke width and
   * corner radius are divided by the zoom to stay constant on screen.
   */
  private drawBand(): void {
    const engine = this.engine;
    const band = this.band;
    if (!engine || !band || this.state.kind !== "rubber") return;

    const rect = rectFromCorners(this.state.anchor, this.state.corner);
    const zoom = engine.camera.zoom;
    const shortest = Math.min(rect.width, rect.height) * zoom;
    const radius = (shortest < 20 ? 0 : Math.min(12, (shortest - 20) / 5)) / zoom;

    band.clear();
    band.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    band.fill({ color: 0x7c9cff, alpha: 0.1 });
    band.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    band.stroke({ width: 1.5 / zoom, color: 0x7c9cff, alpha: 0.7 });
  }
}
