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
import type { DropSourceRenderer } from "../engine/drop";
import { ObjectRenderer } from "../engine/ObjectRenderer";
import {
  drawEdgeHandles,
  edgeHandleAt,
  type EdgeHandlePaint,
  type ResizableRenderer,
  type ResizeHandle,
  resizedRect,
} from "../engine/resize";
import { drawPlusButton, onPlus, type SpawnableRenderer, type SpawnEdge } from "../engine/spawn";
import { easeInCubic, easeOutCubic, easeOutExpo } from "../engine/utils/easing";
import { sheetReturn, sheetStagger, type SheetSlot } from "../folder-sheets";
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
/** Shared with the folder, whose paper has to be back by the time a card lands. */
export const TRAVEL_MS = 260;
/** How long a card takes to fade in as it arrives, and out as it is put away. */
const FADE_MS = 180;
/** How big a card is, as a fraction of itself, when it starts out of a folder. */
const EMERGE_SCALE = 0.4;
/**
 * How much of what it is over a dragged card shrinks to fill. Under one, so the
 * card is visibly inside the outline it is about to be dropped into rather than
 * exactly covering it.
 */
const DROP_FIT = 0.72;
/** How long the shrink takes. Short: it answers a pointer that is still moving. */
const DROP_MS = 140;
/** World units the card is kicked past the right edge before it goes in. */
const SWALLOW_GAP = 28;
const SWALLOW_MS = 300;
/**
 * How much bigger a card is drawn while the pointer is on it or it is selected.
 * Small on purpose: it says "this one" without moving the board around, and it
 * is the same step for both so hovering a selected card does not grow it twice.
 */
const LIFT_SCALE = 1.03;
const LIFT_MS = 120;

/** The selection ring's stroke, in world units and the theme's action colour. */
export interface RingStroke {
  width: number;
  color: number;
}

export abstract class CardRenderer<TData extends CanvasObject = CanvasObject>
  extends ObjectRenderer<TData>
  implements ResizableRenderer, SpawnableRenderer, DropSourceRenderer
{
  readonly container = new Container();

  /**
   * Everything the card is made of, so a kind that is turned on the table — a
   * sticky — rotates as one piece about its own middle. The container itself
   * stays square with the world: its position is the placement, and the tools,
   * the marquee and the drop targets all measure against that rectangle.
   */
  private readonly body = new Container();

  /** Below the surface, so the blur spills onto the table and not onto the card. */
  protected readonly shadow: NineSliceSprite = createShadowSprite();
  protected readonly surface = new Graphics();
  /** Whatever the kind draws inside the card, clipped to the surface. */
  protected readonly content = new Container();
  /**
   * The same shape as the surface, drawn a second time purely to clip `content`.
   * Pixi sets `includeInBuild = false` on whatever is assigned as a mask, so a
   * card that masked with its own surface would stencil correctly and then never
   * draw the surface itself — a board of shadows with no paper on it.
   */
  private readonly clip = new Graphics();
  private readonly ring = new Graphics();
  private readonly handles = new Graphics();
  /** The plus buttons past each edge, for a kind that can be started from. */
  private readonly plus = new Graphics();

  protected data: TData | null = null;
  protected width = MIN_CARD_SIZE.w;
  protected height = MIN_CARD_SIZE.h;
  /** Bumped by the kind whenever what it drew has to be drawn again. */
  protected resolution = 1;
  protected selected = false;

  private signature = "";
  private chromeZoom = 0;
  private raised = false;
  /** False until the first sync has put the card somewhere. */
  private placed = false;
  /** Where the card is easing to, while it is. */
  private travel: { x: number; y: number } | null = null;
  /**
   * How far the card is turned by the sheet it is coming out of or going back
   * into. Zero once it is on the table.
   */
  private lean = 0;
  /**
   * How far out of its folder it is: 0 lying in its sheet, 1 on the table. A card
   * in a folder lies the way the sheet lies, so the turn its own kind gives it —
   * a sticky's — comes in as it comes out, and is gone again as it goes back.
   */
  private settled = 1;
  /** Bumped by every fade, so the container's alpha has one writer at a time. */
  private fade = 0;
  private hotHandle: ResizeHandle | null = null;
  /** Whether the pointer is on this card, which is when its grips are drawn. */
  private hovered = false;
  private resizeFrom: Rect | null = null;
  /** How much of its own size the card is drawn at while it is over a drop target. */
  private dropScale = 1;
  private dropScaleTo = 1;
  /** How much bigger it is drawn while it is hovered or selected. */
  private liftScale = 1;
  private liftScaleTo = 1;
  /** True while the card is being drawn into a folder, which owns its position. */
  private swallowing = false;
  /** The edge whose plus button is showing, and whether the pointer is on it. */
  private plusEdge: SpawnEdge | null = null;
  private plusHot = false;

  constructor(protected readonly engine: CanvasEngineApi) {
    super();
    this.container.eventMode = "static";
    this.container.cursor = "default";
    this.container.addChild(this.body);
    this.body.addChild(
      this.shadow,
      this.surface,
      this.content,
      this.clip,
      this.ring,
      this.handles,
      this.plus,
    );
    this.content.mask = this.clip;
  }

  /**
   * Puts something between the card's surface and the content drawn on it — the
   * folder's paper, which has to sit over the card and travel past its edge.
   * Layers go inside the card rather than beside it, so anything added here is
   * turned with it.
   */
  protected insertBelowContent(child: Container): void {
    this.body.addChildAt(child, this.body.getChildIndex(this.content));
  }

  /** The card's own fill. A sticky is warmer than the sheet beside it. */
  protected abstract surfaceColor(theme: BoardTheme): number;

  /**
   * Whether a task can be started from this card by dragging a plus off its
   * edge. A picture, a clip, a file or a page can be; a folder is a place and a
   * transcript is a task already.
   */
  protected get spawnable(): boolean {
    return false;
  }

  canSpawn(): boolean {
    return this.spawnable;
  }

  plusAt(worldX: number, worldY: number): SpawnEdge | null {
    const edge = this.plusEdge;
    if (!this.spawnable || edge === null) return null;
    const zoom = this.engine.camera.zoom;
    const local = this.toLocal(worldX, worldY);
    return onPlus(local.x, local.y, edge, this.width, this.height, zoom) ? edge : null;
  }

  hoverPlus(edge: SpawnEdge | null, hot: boolean): void {
    const shown = this.spawnable ? edge : null;
    if (shown === this.plusEdge && hot === this.plusHot) return;
    this.plusEdge = shown;
    this.plusHot = hot;
    this.drawChrome();
  }

  /** Fixed for every card but the webclip, which is a capture and stays square. */
  protected get radius(): number {
    return CARD_RADIUS;
  }

  /**
   * How far the card is turned on the table, in radians, about its own middle.
   * Zero for everything but a sticky: paper that was put down by hand is not
   * square with the board, and every other card is a window rather than a note.
   */
  protected get tilt(): number {
    return 0;
  }

  /**
   * A world point in the card's own coordinates, with the tilt taken back out:
   * everything drawn inside the card — its checkboxes, its grips, its plus
   * buttons — is laid out square, so a hit has to be asked about square.
   */
  protected toLocal(worldX: number, worldY: number): { x: number; y: number } {
    const bounds = this.bounds();
    const x = worldX - bounds.x;
    const y = worldY - bounds.y;
    const tilt = this.tilt;
    if (tilt === 0) return { x, y };

    const centreX = this.width / 2;
    const centreY = this.height / 2;
    const cos = Math.cos(-tilt);
    const sin = Math.sin(-tilt);
    const dx = x - centreX;
    const dy = y - centreY;
    return { x: centreX + dx * cos - dy * sin, y: centreY + dx * sin + dy * cos };
  }

  /**
   * The card's own silhouette rather than its placement rectangle, which is what
   * a turned card needs: its corners stand outside the rectangle and its edges
   * stand inside it, and a click has to agree with what is drawn.
   */
  override hitTest(worldX: number, worldY: number): boolean {
    const local = this.toLocal(worldX, worldY);
    return local.x >= 0 && local.y >= 0 && local.x <= this.width && local.y <= this.height;
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
    const width = Math.max(MIN_CARD_SIZE.w, readNumber(data, "w", MIN_CARD_SIZE.w));
    const height = Math.max(MIN_CARD_SIZE.h, readNumber(data, "h", MIN_CARD_SIZE.h));
    // The ring is on the card's edge and the grips are measured off it, so a
    // resize moves both of them and neither is redrawn by anything else.
    const resized = width !== this.width || height !== this.height;
    this.width = width;
    this.height = height;
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

    // The tilt turns the card about its own middle, so the pivot moves with a
    // resize; a card that is not turned keeps the identity transform.
    if (resized || this.body.rotation !== this.bodyRotation()) {
      this.body.pivot.set(this.width / 2, this.height / 2);
      this.body.position.set(this.width / 2, this.height / 2);
      this.body.rotation = this.bodyRotation();
    }

    const selected = selection.includes(data.id);
    if (selected !== this.selected || resized) {
      this.selected = selected;
      this.drawChrome();
      this.liftTo(this.lifted);
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
    // A card on its way into a folder is no longer following its placement: it is
    // where the swallow put it, until the move it caused takes it off the board.
    if (this.swallowing) return;

    // The first sync is an arrival, not a move. A container starts at the world
    // origin, so treating it as a move flies every card in from (0, 0) — which
    // reads as coming out of the folder only for a folder that happens to sit
    // there. A card that declares where it comes from travels from that instead.
    // Sync runs every frame, and a travel in flight to this very place is left
    // alone: restarting it each frame would keep resetting the ease, and the
    // last few units — under the threshold — would snap, which is a visible
    // hitch right at the end of the move.
    const travel = this.travel;
    if (travel && travel.x === x && travel.y === y) return;

    if (!this.placed) {
      this.placed = true;
      const sheet = this.data ? readSheet(this.data, "from") : null;
      if (sheet) {
        // A card coming out of a folder *is* the sheet it was drawn on in there:
        // it covers that sheet exactly — its place, its size, its lean — and lies
        // directly under it, so when the sheet goes at its turn the card is
        // already there and the two are one thing. It squares up and fills out as
        // it travels out from under the folder's front panel.
        //
        // Nothing fades: a card fading in would be a second copy of the sheet
        // arriving, which is the thing this is not. The spawn fade is called off.
        this.fade += 1;
        this.container.alpha = 1;
        this.placeOnSheet(sheet);
        this.travelTo(x, y, sheetStagger(sheet.index, sheet.total));
        return;
      }
      this.container.position.set(x, y);
      return;
    }

    const jumped = Math.hypot(x - this.container.x, y - this.container.y) > TRAVEL_THRESHOLD;
    if (this.raised || !jumped) {
      this.travel = null;
      this.placeAt(x, y);
      return;
    }
    this.travelTo(x, y);
  }

  /**
   * Eases the card from wherever it is, at whatever size and angle it is, to its
   * place at full size and square with the board. A travel started while another
   * is in flight takes over: the older one sees the target has moved on and stops
   * writing.
   */
  private travelTo(x: number, y: number, delay = 0): void {
    const travel = { x, y };
    this.travel = travel;
    const fromX = this.container.x;
    const fromY = this.container.y;
    const fromScaleX = this.container.scale.x;
    const fromScaleY = this.container.scale.y;
    const fromLean = this.lean;
    const fromSettled = this.settled;
    const start = performance.now() + delay;

    this.animate((now) => {
      if (this.travel !== travel) return true;
      const t = Math.min(1, Math.max(0, now - start) / TRAVEL_MS);
      const eased = easeOutExpo(t);
      this.container.position.set(fromX + (x - fromX) * eased, fromY + (y - fromY) * eased);
      if (fromScaleX !== 1 || fromScaleY !== 1)
        this.container.scale.set(
          fromScaleX + (1 - fromScaleX) * eased,
          fromScaleY + (1 - fromScaleY) * eased,
        );
      if (fromLean !== 0 || fromSettled !== 1)
        this.turnTo(fromLean * (1 - eased), fromSettled + (1 - fromSettled) * eased);
      if (t < 1) return false;
      this.travel = null;
      return true;
    });
  }

  /**
   * The card as the sheet it is drawn on inside a folder: the same rectangle,
   * exactly. Squashed to the sheet's shape rather than fitted inside it, because a
   * card that merely sat in the sheet's middle would show as a different thing
   * appearing there the moment the sheet went. It squares up over the travel out.
   *
   * Sized and then leaned about its top left corner, which is how the sheet itself
   * is drawn — the other order shears a leaning card that is taller than it is
   * wide, and the two stop meeting at the folder's edge.
   */
  private placeOnSheet(sheet: SheetSlot): void {
    this.container.scale.set(sheet.w / this.width, sheet.h / this.height);
    this.container.position.set(sheet.x, sheet.y);
    this.turnTo(sheet.lean, 0);
  }

  /**
   * The card's two turns: the sheet's, about its top left corner, the way a sheet
   * in a folder leans; and its own kind's, about its middle, which it only has
   * once it is out on the table.
   */
  private turnTo(lean: number, settled: number): void {
    this.lean = lean;
    this.settled = settled;
    this.container.rotation = lean;
    this.body.rotation = this.bodyRotation();
  }

  private bodyRotation(): number {
    return this.tilt * this.settled;
  }

  /**
   * The one writer of the card's alpha: a card fading in as it arrives, out as it
   * is put away, and back in when a put-away is called off are the same fade, and
   * two of them writing at once is how a card ends up half there.
   */
  private fadeTo(target: number, delay = 0): void {
    const from = this.container.alpha;
    const generation = (this.fade += 1);
    const start = performance.now() + delay;

    this.animate((now) => {
      if (this.fade !== generation) return true;
      const t = Math.min(1, Math.max(0, now - start) / FADE_MS);
      this.container.alpha = from + (target - from) * t;
      return t >= 1;
    });
  }

  /**
   * The card at its own size, or at the fraction of it a drop preview asked for.
   * Scaled about its middle, so shrinking it over a folder keeps it under the
   * pointer rather than pulling it towards its own top left corner.
   */
  private placeAt(x: number, y: number): void {
    const scale = this.dropScale * this.liftScale;
    this.container.scale.set(scale);
    this.container.position.set(
      x + (this.width * (1 - scale)) / 2,
      y + (this.height * (1 - scale)) / 2,
    );
  }

  /**
   * Held over something that would take it: the card shrinks towards the size of
   * that thing, which says the drop would mean something before it is made. The
   * position follows from `moveTo`, which runs every frame while the drag does.
   */
  previewDrop(target: Rect | null): void {
    const fit = target
      ? Math.min(
          1,
          (Math.min(target.width / this.width, target.height / this.height) || 1) * DROP_FIT,
        )
      : 1;
    if (fit === this.dropScaleTo) return;
    this.dropScaleTo = fit;

    const from = this.dropScale;
    const start = performance.now();
    this.animate((now) => {
      // A preview that changed mid-ease hands the card to the newer one.
      if (this.dropScaleTo !== fit) return true;
      const t = Math.min(1, (now - start) / DROP_MS);
      this.dropScale = from + (fit - from) * easeOutCubic(t);
      return t >= 1;
    });
  }

  /**
   * Let go over a folder. The card lines up on the folder's middle and out to its
   * right, then travels into it and shrinks away — the reverse of the way a
   * folder's contents come out of it, so the two gestures read as one thing.
   *
   * It ends by putting the card back the way it found it. The move it triggered
   * takes the card off the board a moment later; one that failed leaves a card
   * that is simply where it was, rather than an invisible one.
   */
  swallowInto(target: Rect): void {
    this.travel = null;
    this.swallowing = true;
    this.dropScale = 1;
    this.dropScaleTo = 1;

    const scale = Math.min(
      1,
      Math.min(target.width / this.width, target.height / this.height) || 1,
    );
    const fromX = target.x + target.width + SWALLOW_GAP;
    const fromY = target.y + (target.height - this.height * scale) / 2;
    const toX = target.x + (target.width - this.width * EMERGE_SCALE) / 2;
    const toY = target.y + (target.height - this.height * EMERGE_SCALE) / 2;

    this.container.position.set(fromX, fromY);
    this.container.scale.set(scale);
    const start = performance.now();
    this.animate((now) => {
      const t = Math.min(1, (now - start) / SWALLOW_MS);
      const eased = easeOutCubic(t);
      this.container.position.set(fromX + (toX - fromX) * eased, fromY + (toY - fromY) * eased);
      this.container.scale.set(scale + (EMERGE_SCALE - scale) * eased);
      this.container.alpha = 1 - eased;
      if (t < 1) return false;
      this.swallowing = false;
      this.container.alpha = 1;
      this.container.scale.set(1);
      return true;
    });
  }

  /**
   * A card being dragged, or sitting on top of a pile, is lifted further off the
   * table. Set by the tool rather than inferred: only the gesture knows.
   */
  setRaised(raised: boolean): void {
    if (raised === this.raised) return;
    this.raised = raised;
    this.drawSurface();
    this.liftTo(this.lifted);
  }

  /**
   * A card lands rather than pops: the board is a table things are put down on,
   * and the scale-up the base renderer does would swing it in from a corner,
   * since a card is positioned by its top left and has no pivot.
   */
  override spawn(): void {
    this.container.alpha = 0;
    this.fadeTo(1);
  }

  /**
   * Put away rather than dismissed: a card that came out of a sheet inside a
   * folder goes back into that sheet, the same move run backwards — it gathers
   * speed as it goes in, where it lost speed coming out. The curve is the gentler
   * of the pair: the swoosh out reversed exactly would leave the card hanging
   * still while the rest of the board finished closing around it, and then snatch
   * it in at the last moment.
   *
   * It lands squashed exactly onto the sheet and is taken off the board there, one
   * frame after the sheet is due back under it; nothing fades, because nothing is
   * dismissed. The frame of overlap is invisible — the two are the same rectangle
   * — where a frame of neither is a blink of empty folder.
   *
   * A card with no sheet to go back to leaves the way everything else does.
   */
  override exit(done: () => void): void {
    const sheet = this.data ? readSheet(this.data, "from") : null;
    if (!sheet) {
      super.exit(done);
      return;
    }
    if (!this.beginExit()) return;

    // The travel is over: from here the exit owns where the card is, and a
    // placement arriving mid-flight must not drag it back out.
    this.travel = null;
    const fromX = this.container.x;
    const fromY = this.container.y;
    const fromScaleX = this.container.scale.x;
    const fromScaleY = this.container.scale.y;
    const fromLean = this.lean;
    const fromSettled = this.settled;
    const scaleX = sheet.w / this.width;
    const scaleY = sheet.h / this.height;

    // Last out is first back in, which is what the way out looks like reversed.
    const generation = this.exitGeneration;
    const fade = (this.fade += 1);
    const start = performance.now() + sheetReturn(sheet.total - 1 - sheet.index, sheet.total);
    let landed = false;
    this.animate((now) => {
      if (this.exitGeneration !== generation || this.fade !== fade) return true;
      const t = Math.min(1, Math.max(0, now - start) / TRAVEL_MS);
      const eased = easeInCubic(t);
      this.container.position.set(
        fromX + (sheet.x - fromX) * eased,
        fromY + (sheet.y - fromY) * eased,
      );
      this.container.scale.set(
        fromScaleX + (scaleX - fromScaleX) * eased,
        fromScaleY + (scaleY - fromScaleY) * eased,
      );
      this.turnTo(fromLean + (sheet.lean - fromLean) * eased, fromSettled * (1 - eased));
      if (t < 1) return false;
      if (!landed) {
        landed = true;
        return false;
      }
      done();
      return true;
    });
  }

  /** The folder opened again while this was going back in: it comes out again. */
  override cancelExit(): void {
    if (!this.exiting) return;
    super.cancelExit();
    this.fadeTo(1);
    const data = this.data;
    // A card that never got as far as a sync has nowhere to travel back to, so
    // its size is put right here instead of by the travel.
    if (!data) {
      this.container.scale.set(1);
      return;
    }
    this.travelTo(readNumber(data, "x", 0), readNumber(data, "y", 0));
  }

  /**
   * Nothing snaps: the travel back out is what returns the scale and the lean,
   * and the fade is what returns the alpha.
   */
  protected override restoreAfterExit(): void {}

  override bounds(): Rect {
    const data = this.data;
    return {
      x: data ? readNumber(data, "x", 0) : 0,
      y: data ? readNumber(data, "y", 0) : 0,
      width: this.width,
      height: this.height,
    };
  }

  /** One description of the bars, so what is drawn and what can be grabbed agree. */
  private handlePaint(): EdgeHandlePaint {
    return {
      color: SELECTION.handleColor,
      length: SELECTION.handleLength,
      thickness: SELECTION.handleThickness,
      inset: SELECTION.handleInset,
    };
  }

  /** Whether the card can be resized by its edges. A folder is one size. */
  protected get resizable(): boolean {
    return true;
  }

  handleAt(worldX: number, worldY: number): ResizeHandle | null {
    if (!this.resizable) return null;
    const local = this.toLocal(worldX, worldY);
    return edgeHandleAt(
      local.x,
      local.y,
      this.width,
      this.height,
      this.engine.camera.zoom,
      this.handlePaint(),
      SELECTION.handleReach,
    );
  }

  hoverHandle(handle: ResizeHandle | null, overObject = false): void {
    if (handle === this.hotHandle && overObject === this.hovered) return;
    this.hotHandle = handle;
    this.hovered = overObject;
    this.drawChrome();
    this.liftTo(this.lifted);
  }

  /**
   * Under the pointer, or picked: either is the card being singled out. Not while
   * it is being dragged, though — the alignment guides are drawn against the
   * card's own rectangle, and a card 3% over that size reads as missing the line
   * it has actually been snapped to. A drag has the shadow to say it is lifted.
   */
  protected get lifted(): boolean {
    if (this.raised) return false;
    return this.hovered || this.selected;
  }

  /**
   * Eases the card to its lifted size, or back. Scaled about its middle by
   * `placeAt`, which runs every frame, so this only has to move the number.
   */
  private liftTo(lifted: boolean): void {
    const target = lifted ? LIFT_SCALE : 1;
    if (target === this.liftScaleTo) return;
    this.liftScaleTo = target;

    const from = this.liftScale;
    const start = performance.now();
    this.animate((now) => {
      if (this.liftScaleTo !== target) return true;
      const t = Math.min(1, (now - start) / LIFT_MS);
      this.liftScale = from + (target - from) * easeOutCubic(t);
      return t >= 1;
    });
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

  /**
   * The card's silhouette, traced and left for the caller to fill or stroke. A
   * kind whose card is not a rounded rectangle — the folder, with its notch —
   * overrides this, and by tracing into whichever `Graphics` it is handed it
   * keeps the surface, the clip and the selection ring the same shape without
   * any of them knowing about the others.
   */
  protected traceShape(target: Graphics): void {
    target.roundRect(0, 0, this.width, this.height, this.radius);
  }

  /**
   * The selection ring, stroked along the card's own silhouette, or cleared when
   * `stroke` is null. `ring` is already cleared and sits above the content. A
   * kind whose silhouette is more than one shape — the folder, whose paper is
   * partly under its panel — overrides this to ring each part on its own layer,
   * rather than drawing the hidden edge of one across the face of the other.
   */
  protected drawRing(ring: Graphics, stroke: RingStroke | null): void {
    if (stroke === null) return;
    this.traceShape(ring);
    ring.stroke({ ...stroke, alignment: 0.5 });
  }

  /**
   * The part of the card the shadow is cast from. The baked texture is a rounded
   * rectangle, so a kind whose silhouette is notched has to say which rectangle
   * it fills — otherwise the shadow paints a grey block into the notch, which is
   * exactly what the folder's tab was showing.
   */
  protected shadowBox(): Rect {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  protected drawSurface(): void {
    const box = this.shadowBox();
    applyShadow(
      this.shadow,
      box.width,
      box.height,
      this.radius,
      this.raised ? CARD_SHADOW_RAISED : CARD_SHADOW,
      { x: box.x, y: box.y },
    );
    this.traceShape(this.surface.clear());
    this.surface.fill({ color: this.surfaceColor(this.theme()) });
    // Everything a kind draws is clipped to the card's own corners, so a picture
    // meets the rounding rather than squaring it off. The colour is irrelevant on
    // the clip: it is stencilled, never drawn.
    this.traceShape(this.clip.clear());
    this.clip.fill({ color: 0xffffff });
  }

  private drawChrome(): void {
    const zoom = this.engine.camera.zoom;
    this.chromeZoom = zoom;
    const scale = Math.max(0.2, zoom);
    const theme = this.theme();

    // On the card's own edge, not hung outside it: the ring says which thing is
    // selected, and a ring floating off the edge reads as a second rectangle.
    // Its width is capped against the card so a small card zoomed out does not
    // disappear inside its own outline.
    const width = Math.min(SELECTION.ringWidth / scale, Math.min(this.width, this.height) / 12);
    this.drawRing(this.ring.clear(), this.selected ? { width, color: theme.action } : null);

    drawEdgeHandles(
      this.handles,
      this.width,
      this.height,
      zoom,
      // Hovering is enough: a card is resized from wherever the pointer already
      // is, without being picked up first.
      this.hovered && this.resizable,
      this.hotHandle,
      this.handlePaint(),
    );
    drawPlusButton(this.plus, this.width, this.height, zoom, this.plusEdge, this.plusHot);
  }
}

export function readNumber(data: CanvasObject, key: string, fallback: number): number {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A sheet a card carries, or null where it carries none or carries nonsense. */
export function readSheet(data: CanvasObject, key: string): SheetSlot | null {
  const value = data[key];
  if (typeof value !== "object" || value === null) return null;
  const sheet = value as Record<string, unknown>;
  for (const field of ["x", "y", "w", "h", "lean", "index", "total"]) {
    if (!Number.isFinite(sheet[field])) return null;
  }
  return {
    x: Number(sheet["x"]),
    y: Number(sheet["y"]),
    w: Number(sheet["w"]),
    h: Number(sheet["h"]),
    lean: Number(sheet["lean"]),
    index: Number(sheet["index"]),
    total: Number(sheet["total"]),
  };
}

/** Board objects are open records, so a field a card wants may not be there. */
export function readString(data: CanvasObject, key: string): string {
  const value = data[key];
  if (typeof value !== "string") return "";
  return value;
}
