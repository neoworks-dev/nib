/**
 * What every card on the board has in common: a shadow under it, one corner
 * radius, a white selection ring outside its edge, and four grey bars at the
 * edge midpoints that resize it.
 *
 * A kind supplies its surface colour, its radius and whatever it draws inside
 * `content`; nothing below that is a kind's business. The geometry is read off
 * the object each frame because a card's rectangle is its placement, and the
 * placement is the only thing on the board that is the app's own.
 */

import type { CanvasEngineApi, CanvasObject, Rect } from "@nib-ui/ui-contracts";
import { Container, Graphics, type NineSliceSprite } from "pixi.js";
import { MIN_CARD_SIZE } from "../board-view";
import { ObjectRenderer } from "../engine/ObjectRenderer";
import {
  drawEdgeHandles,
  edgeHandleAt,
  type ResizableRenderer,
  type ResizeHandle,
  resizedRect,
} from "../engine/resize";
import { applyShadow, createShadowSprite } from "../engine/utils/shadow";
import { resolutionForZoom } from "../engine/utils/textTexture";
import {
  type BoardTheme,
  CARD_RADIUS,
  CARD_SHADOW,
  CARD_SHADOW_RAISED,
  SELECTION,
  themeRevision,
} from "../theme";

/**
 * World units a placement has to jump before the card eases across rather than
 * snapping. Comfortably above what a drag or a resize moves in one frame, and
 * comfortably below what folding a pile moves.
 */
const TRAVEL_THRESHOLD = 32;
const TRAVEL_MS = 240;

export abstract class CardRenderer<TData extends CanvasObject = CanvasObject>
  extends ObjectRenderer<TData>
  implements ResizableRenderer
{
  readonly container = new Container();

  /** Below the surface, so the blur spills onto the table and not onto the card. */
  protected readonly shadow: NineSliceSprite = createShadowSprite();
  protected readonly surface = new Graphics();
  /** Whatever the kind draws inside the card, clipped to the surface. */
  protected readonly content = new Container();
  private readonly ring = new Graphics();
  private readonly handles = new Graphics();

  protected data: TData | null = null;
  protected width = MIN_CARD_SIZE.w;
  protected height = MIN_CARD_SIZE.h;
  /** Bumped by the kind whenever what it drew has to be drawn again. */
  protected resolution = 1;
  protected selected = false;

  private signature = "";
  private chromeZoom = 0;
  private raised = false;
  private hotHandle: ResizeHandle | null = null;
  private resizeFrom: Rect | null = null;

  constructor(protected readonly engine: CanvasEngineApi) {
    super();
    this.container.eventMode = "static";
    this.container.cursor = "default";
    this.container.addChild(this.shadow, this.surface, this.content, this.ring, this.handles);
  }

  /** The card's own fill. A sticky is warmer than the sheet beside it. */
  protected abstract surfaceColor(theme: BoardTheme): number;

  /** Fixed for every card but the webclip, which is a capture and stays square. */
  protected get radius(): number {
    return CARD_RADIUS;
  }

  protected abstract theme(): BoardTheme;

  /**
   * Redraws what the kind puts inside the card. Called only when the signature
   * changes, so it may be as expensive as baking a texture.
   */
  protected abstract drawContent(): void;

  /**
   * What the kind's content depends on. Anything not named here will not cause a
   * redraw, and anything named that changes every frame will cause one every
   * frame — the width, height and bake resolution are already included.
   */
  protected abstract contentSignature(data: TData): string;

  sync(data: TData, selection: string[]): void {
    this.data = data;
    this.width = Math.max(MIN_CARD_SIZE.w, readNumber(data, "w", MIN_CARD_SIZE.w));
    this.height = Math.max(MIN_CARD_SIZE.h, readNumber(data, "h", MIN_CARD_SIZE.h));
    this.resolution = resolutionForZoom(this.engine.camera.zoom);

    const signature = [
      this.contentSignature(data),
      this.width,
      this.height,
      this.resolution,
      themeRevision(),
    ].join(" ");
    if (signature !== this.signature) {
      this.signature = signature;
      this.drawSurface();
      this.drawContent();
    }

    const selected = selection.includes(data.id);
    if (selected !== this.selected) {
      this.selected = selected;
      this.drawChrome();
    }
    // Chrome is sized in screen pixels, so it has to be redrawn as the camera
    // moves. A small step is ignored: the ring is 3px and nobody can see 2%.
    if (Math.abs(this.engine.camera.zoom - this.chromeZoom) > this.chromeZoom * 0.02)
      this.drawChrome();

    this.moveTo(readNumber(data, "x", 0), readNumber(data, "y", 0));
  }

  /**
   * A card follows its placement, and eases when the placement jumps: folding a
   * selection into a pile, spreading one back out and laying a folder's contents
   * beside it all move cards a long way at once, and they should travel rather
   * than teleport.
   *
   * A card being dragged is pinned to the pointer instead — a tween there would
   * lag the cursor — and a resize moves the edge a few units a frame, which is
   * under the threshold and snaps.
   */
  private moveTo(x: number, y: number): void {
    const jumped = Math.hypot(x - this.container.x, y - this.container.y) > TRAVEL_THRESHOLD;
    if (this.raised || !jumped) {
      this.container.position.set(x, y);
      return;
    }
    this.tweenTo(x, y, TRAVEL_MS);
  }

  /**
   * A card being dragged, or sitting on top of a pile, is lifted further off the
   * table. Set by the tool rather than inferred: only the gesture knows.
   */
  setRaised(raised: boolean): void {
    if (raised === this.raised) return;
    this.raised = raised;
    this.drawSurface();
  }

  /**
   * A card lands rather than pops: the board is a table things are put down on,
   * and the scale-up the base renderer does would swing it in from a corner,
   * since a card is positioned by its top left and has no pivot.
   */
  override spawn(): void {
    this.container.alpha = 0;
    const start = performance.now();
    this.animate((now) => {
      const t = Math.min(1, (now - start) / 180);
      this.container.alpha = t;
      return t >= 1;
    });
  }

  override bounds(): Rect {
    const data = this.data;
    return {
      x: data ? readNumber(data, "x", 0) : 0,
      y: data ? readNumber(data, "y", 0) : 0,
      width: this.width,
      height: this.height,
    };
  }

  handleAt(worldX: number, worldY: number): ResizeHandle | null {
    if (!this.selected) return null;
    const bounds = this.bounds();
    return edgeHandleAt(
      worldX - bounds.x,
      worldY - bounds.y,
      this.width,
      this.height,
      this.engine.camera.zoom,
      SELECTION.handleLength,
      SELECTION.handleReach,
    );
  }

  hoverHandle(handle: ResizeHandle | null): void {
    if (handle === this.hotHandle) return;
    this.hotHandle = handle;
    this.drawChrome();
  }

  beginResize(): void {
    this.resizeFrom = this.bounds();
  }

  applyResize(handle: ResizeHandle, deltaX: number, deltaY: number): void {
    const from = this.resizeFrom;
    const data = this.data;
    if (!from || !data) return;

    // Measured from the size the gesture started at, so the far edge stays put.
    const next = resizedRect(from, handle, deltaX, deltaY, true, MIN_CARD_SIZE.w);
    this.engine.updateObject(data.id, { x: next.x, y: next.y, w: next.width, h: next.height });
  }

  endResize(): void {
    this.resizeFrom = null;
  }

  protected drawSurface(): void {
    applyShadow(
      this.shadow,
      this.width,
      this.height,
      this.radius,
      this.raised ? CARD_SHADOW_RAISED : CARD_SHADOW,
    );
    this.surface
      .clear()
      .roundRect(0, 0, this.width, this.height, this.radius)
      .fill({ color: this.surfaceColor(this.theme()) });
    // Everything a kind draws is clipped to the card's own corners, so a picture
    // meets the rounding rather than squaring it off.
    this.content.mask = this.surface;
  }

  private drawChrome(): void {
    const zoom = this.engine.camera.zoom;
    this.chromeZoom = zoom;
    const scale = Math.max(0.2, zoom);
    const theme = this.theme();

    this.ring.clear();
    if (this.selected) {
      const offset = SELECTION.ringOffset / scale;
      const width = SELECTION.ringWidth / scale;
      this.ring.roundRect(
        -offset - width / 2,
        -offset - width / 2,
        this.width + offset * 2 + width,
        this.height + offset * 2 + width,
        this.radius + offset,
      );
      this.ring.stroke({ width, color: theme.action, alignment: 0.5 });
    }

    drawEdgeHandles(this.handles, this.width, this.height, zoom, this.selected, this.hotHandle, {
      color: SELECTION.handleColor,
      length: SELECTION.handleLength,
      thickness: SELECTION.handleThickness,
    });
  }
}

export function readNumber(data: CanvasObject, key: string, fallback: number): number {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Board objects are open records, so a field a card wants may not be there. */
export function readString(data: CanvasObject, key: string): string {
  const value = data[key];
  if (typeof value !== "string") return "";
  return value;
}
