import type { Disposer } from "@nib-ui/kernel";
import type { CanvasPointerEvent, CanvasTool, Point } from "@nib-ui/ui-contracts";
import { Graphics } from "pixi.js";
import type { CanvasEngine } from "../CanvasEngine";
import { HANDLE_CURSORS, isPressable, isResizable, type ResizeHandle } from "../resize";
import { rectFromCorners } from "../utils/geometry";
import { CARD_RADIUS, MARQUEE, SELECTION } from "../../theme";

const DRAG_THRESHOLD = 5;

type State =
  | { kind: "idle" }
  | { kind: "pending"; targetId: string; screen: Point; additive: boolean }
  | {
      kind: "dragging";
      screen: Point;
      origins: { id: string; x: number; y: number }[];
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

    // The right button is the context menu and nothing else. The engine opens it
    // on release, so the gesture is refused here rather than claimed.
    if (event.button !== 0) return false;

    const additive = event.shiftKey || event.metaKey;

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
        overId: null,
      };
      this.setRaised(
        this.state.origins.map((origin) => origin.id),
        true,
      );
    }

    if (this.state.kind === "dragging") {
      const deltaX = (event.screen.x - this.state.screen.x) / engine.camera.zoom;
      const deltaY = (event.screen.y - this.state.screen.y) / engine.camera.zoom;
      for (const origin of this.state.origins) {
        engine.updateObject(origin.id, { x: origin.x + deltaX, y: origin.y + deltaY });
      }
      // The cards being dragged are under the pointer themselves, so the target is
      // the topmost one that is not part of the drag.
      const dragged = new Set(this.state.origins.map((origin) => origin.id));
      this.state = {
        ...this.state,
        overId: engine.hitTestExcluding(event.screen.x, event.screen.y, dragged),
      };
      this.drawDropTarget(this.state.overId);
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
      case "resizing": {
        const renderer = engine?.rendererFor(state.targetId);
        if (isResizable(renderer)) renderer.endResize();
        state.history();
        this.setCursor("");
        return;
      }
      case "dragging": {
        this.band?.clear();
        const ids = state.origins.map((origin) => origin.id);
        this.setRaised(ids, false);
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

  /** Resize handles belong to the selection, so only it is asked. */
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

    this.setCursor(cursor);
  }

  /** Outlines the topic a drop would land in, and nothing when there is none. */
  private drawDropTarget(overId: string | null): void {
    const engine = this.engine;
    const band = this.band;
    if (!engine || !band) return;

    band.clear();
    const bounds = overId ? engine.objectBounds(overId) : null;
    if (!bounds) return;

    const zoom = engine.camera.zoom;
    const inset = SELECTION.ringOffset / zoom;
    band.roundRect(
      bounds.x - inset,
      bounds.y - inset,
      bounds.width + inset * 2,
      bounds.height + inset * 2,
      CARD_RADIUS + inset,
    );
    band.stroke({ width: SELECTION.ringWidth / zoom, color: SELECTION.handleColor });
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
