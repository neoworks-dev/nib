/**
 * A folder: a directory, which is a topic (PLAN §5). Drawn as the physical thing
 * rather than as a card with a folder icon on it.
 *
 * Three layers, back to front, which is what makes it read as a wallet holding
 * something rather than as a card with a picture of a folder on it:
 *
 * 1. the item inside, a sheet of paper leaning a little, whose right edge stands
 *    out past the front panel;
 * 2. the front panel, a rounded rectangle with a thumb notch cut into the middle
 *    of its right edge, so more of the paper shows there;
 * 3. the arrow badge, the name and the count, which sit on the panel.
 *
 * The silhouette is the whole point, so this is the one kind that does not use
 * the base renderer's rounded-rectangle surface.
 */

import type {
  ActivationGesture,
  CanvasEngineApi,
  CanvasObjectKind,
  CanvasObjectRenderer,
} from "@nib-ui/ui-contracts";
import type { Point, Rect } from "@nib-ui/ui-contracts";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { type FolderObject, type FolderPeek, parseFolder } from "../board-view";
import { type CardKind, isVideoPath } from "../card-kind";
import { loadTexture } from "../engine/utils/texture";
import {
  drawnSheets,
  FOLDER_FRONT_WIDTH,
  folderSheets,
  sheetReturn,
  sheetStagger,
  type SheetSlot,
} from "../folder-sheets";
import {
  type BakedText,
  SANS,
  type TextRun,
  type TextTextureCache,
} from "../engine/utils/textTexture";
import { type BoardTheme, CARD_RADIUS, CARD_TYPE, themeRevision } from "../theme";
import { CardRenderer, type RingStroke, TRAVEL_MS } from "./CardRenderer";

/**
 * The thumb notch in the panel's right edge: where it starts and stops, as
 * fractions of the height, and how deep it cuts, as a fraction of the width. A
 * panel with a straight edge read as a plain rectangle in front of another
 * rectangle; the notch is what makes it a folder.
 */
const NOTCH_TOP = 0.3;
const NOTCH_BOTTOM = 0.72;
const NOTCH_DEPTH = 0.08;

/**
 * How many sheets are given the picture they stand for. Past the front few a
 * sheet shows a strip of its right edge and nothing else, so a picture there
 * would cost a texture to draw a line — and a folder of a hundred pictures would
 * fetch a hundred of them to show four.
 */
const PAPER_PICTURES = 4;

/**
 * The arrow badge, in world units. Spatial puts it in the card's top left; here
 * it is pressed to go into the folder, which is the one gesture the card has
 * that a single click on the card itself does not already mean.
 */
const BADGE_RADIUS = 16;

export interface FolderDeps {
  theme(): BoardTheme;
  textures: TextTextureCache;
  /** Where the paper reads its own bytes from; null with no project open. */
  fileUrl(path: string): string | null;
  /** A single click lays the folder's contents out beside it. */
  preview(folder: FolderObject): void;
  /** A double click enters it: its board replaces the canvas. */
  enter(folder: FolderObject): void;
}

/**
 * The item standing out of the folder, drawn as the thing it is: the picture for
 * a picture, and blank paper for anything else. The mask is its own, because a
 * picture wider than the paper has to meet the paper's corners rather than the
 * card's.
 */
interface Paper {
  container: Container;
  surface: Graphics;
  picture: Sprite;
  /** The paper's share of the selection ring, under the panel with the paper. */
  ring: Graphics;
  clip: Graphics;
  /** The path whose bytes were asked for, so each file is fetched once. */
  loadedPath: string;
  /** Where the paper was last laid out, for a picture that lands after the draw. */
  box: Rect;
  /** Whether its card has been pulled out of the folder and has not come back. */
  gone: boolean;
}

class FolderCardRenderer extends CardRenderer<FolderObject> {
  /** Front sheet first: the one the folder's first item is printed on. */
  private readonly papers: Paper[] = [];
  private readonly front = new Graphics();
  private readonly badge = new Graphics();
  private readonly label = new Sprite();
  /** Whether the pointer is on the badge, which is the one thing that lights up. */
  private badgeHot = false;
  /** Where they are heading, which is not where they are while turns are pending. */
  private paperTarget = false;
  /** False until the first draw has put the paper where it starts. */
  private paperSettled = false;
  /** Bumped by every swap, so a folder closed mid-open has one set of turns, not two. */
  private paperSwap = 0;

  constructor(
    engine: CanvasEngineApi,
    private readonly deps: FolderDeps,
  ) {
    super(engine);
    this.content.addChild(this.front, this.badge, this.label);
  }

  /**
   * Sheets for a folder that has grown. Built deepest first and re-inserted in
   * the same order, because each insert goes directly under the content: the
   * sheet put in last is the one in front, and a new sheet is always a deeper one.
   */
  private ensurePapers(count: number): void {
    if (count <= this.papers.length) return;
    while (this.papers.length < count) {
      const container = new Container();
      const surface = new Graphics();
      const picture = new Sprite();
      const ring = new Graphics();
      const clip = new Graphics();
      // The ring is outside the mask: half its width lies past the paper's edge.
      container.addChild(surface, picture, clip, ring);
      surface.mask = clip;
      picture.mask = clip;
      picture.visible = false;
      this.papers.push({
        container,
        surface,
        picture,
        ring,
        clip,
        loadedPath: "",
        box: { x: 0, y: 0, width: 1, height: 1 },
        // A sheet made for a folder that is open is already out: its card is on
        // the table, and a sheet drawn under it would be a second copy of it.
        gone: this.paperTarget,
      });
    }
    // The paper sits between the card's surface and its content rather than in
    // the content: the content is clipped to the silhouette, and a paper has to
    // be able to show past its edge.
    for (const paper of [...this.papers].reverse()) this.insertBelowContent(paper.container);
  }

  protected theme(): BoardTheme {
    return this.deps.theme();
  }

  /** One size, always: the silhouette is the card, and it does not stretch. */
  protected override get resizable(): boolean {
    return false;
  }

  /**
   * Nor does it grow under the pointer. The sheets inside it are where its
   * contents come out of and go back into, and those places are worked out from
   * the card's placement: a folder drawn 3% over that would hand its contents over
   * 3% out of place, and the swap between a sheet and its card would show. The
   * ring and the badge are what say the card is being pointed at.
   */
  protected override get lifted(): boolean {
    return false;
  }

  /** The front panel's own grey, which is most of what the card is. */
  protected surfaceColor(theme: BoardTheme): number {
    return theme.cardRaised;
  }

  /**
   * The front sheets by name and the rest by number: a folder of two hundred
   * items redraws when one of them changes the face it shows, and does not build
   * a two-hundred-item string every frame to find that out.
   */
  protected contentSignature(data: FolderObject): string {
    const peek = data.peek
      .slice(0, PAPER_PICTURES)
      .map((item) => `${item.kind}:${item.path}:${item.label}`)
      .join(",");
    return [
      data.id,
      data.name,
      data.title ?? "",
      data.count,
      data.peek.length,
      peek,
      data.opened === true,
    ].join(" ");
  }

  /**
   * The shadow is cast by the front panel alone. The paper lies on the panel
   * rather than under the card, and shadowing the whole rectangle would put a
   * grey block out past the panel's top right, where the card is not.
   */
  protected override shadowBox(): Rect {
    return { x: 0, y: 0, width: this.width * FOLDER_FRONT_WIDTH, height: this.height };
  }

  /**
   * The silhouette: the front panel, plus the paper standing out past its right
   * edge while there is one. Two subpaths, so the surface is under both. An
   * opened or empty folder is its panel alone: a surface under a paper that is
   * not there would draw it back.
   */
  protected override traceShape(target: Graphics): void {
    // One fill under all of them, so the sheets go in whatever order they come.
    if (this.data?.opened !== true) {
      for (const slot of this.sheetSlots()) {
        const cos = Math.cos(slot.lean);
        const sin = Math.sin(slot.lean);
        target
          .setTransform(cos, sin, -sin, cos, slot.x, slot.y)
          .roundRect(0, 0, slot.w, slot.h, this.paperRadius())
          .resetTransform();
      }
    }
    this.traceFront(target);
  }

  /**
   * Where the sheets are: one per item, save that a folder fat enough to have
   * filled its fan draws the back of the pile as one sheet rather than as
   * hundreds standing in the same place. Every item still has a slot of its own —
   * that is what the cards come out of — and the slots past the fan are the
   * deepest one, which is where a fat folder's back sheets are.
   */
  private sheetSlots(): SheetSlot[] {
    const data = this.data;
    if (data === null) return [];
    const count = data.peek.length;
    return folderSheets(count, this.width, this.height).slice(0, drawnSheets(count, this.height));
  }

  /**
   * The panel is ringed above everything, and the paper on its own layer under
   * the panel, so the ring follows the folder's outline: the paper's edge shows
   * where the paper does and the panel hides the rest of it. The paper's ring
   * lives with the paper, so it leaves and returns as the paper does.
   */
  protected override drawRing(ring: Graphics, stroke: RingStroke | null): void {
    for (const paper of this.papers) paper.ring.clear();
    if (stroke === null) return;
    this.traceFront(ring);
    ring.stroke({ ...stroke, alignment: 0.5 });
    for (const paper of this.papers) {
      if (!paper.container.visible) continue;
      const box = paper.box;
      paper.ring.roundRect(0, 0, box.width, box.height, this.paperRadius());
      paper.ring.stroke({ ...stroke, alignment: 0.5 });
    }
  }

  /**
   * The panel with the notch in its right edge. Traced rather than filled,
   * because both the silhouette and the panel itself are this shape and a second
   * copy of it would drift.
   */
  private traceFront(target: Graphics): void {
    const radius = Math.min(CARD_RADIUS, this.width / 6, this.height / 6);
    const front = this.width * FOLDER_FRONT_WIDTH;
    const depth = this.width * NOTCH_DEPTH;
    const inner = front - depth;
    const top = this.height * NOTCH_TOP;
    const bottom = this.height * NOTCH_BOTTOM;
    // Each S-bend is a cubic whose control points sit halfway down it, so the
    // edge leaves and rejoins the vertical without a kink.
    const bend = Math.min(depth * 1.4, (bottom - top) / 2);

    target
      .moveTo(radius, 0)
      .lineTo(front - radius, 0)
      .arcTo(front, 0, front, radius, radius)
      .lineTo(front, top)
      .bezierCurveTo(front, top + bend / 2, inner, top + bend / 2, inner, top + bend)
      .lineTo(inner, bottom - bend)
      .bezierCurveTo(inner, bottom - bend / 2, front, bottom - bend / 2, front, bottom)
      .lineTo(front, this.height - radius)
      .arcTo(front, this.height, front - radius, this.height, radius)
      .lineTo(radius, this.height)
      .arcTo(0, this.height, 0, this.height - radius, radius)
      .lineTo(0, radius)
      .arcTo(0, 0, radius, 0, radius)
      .closePath();
  }

  private paperRadius(): number {
    return Math.min(CARD_RADIUS, this.width / 8);
  }

  protected drawContent(): void {
    const data = this.data;
    if (!data) return;

    const theme = this.deps.theme();
    const slots = this.sheetSlots();
    this.ensurePapers(slots.length);
    this.papers.forEach((paper, depth) =>
      this.drawPaper(paper, depth, slots[depth], data.peek[depth], theme),
    );
    this.placePapers();
    this.swapPapers(data.opened === true);
    this.drawFront(theme);
    this.drawBadge(theme);
    this.drawLabel(data, theme);
  }

  /** The sheet at this depth, or nothing: a folder holding two has two sheets. */
  private drawPaper(
    paper: Paper,
    depth: number,
    slot: SheetSlot | undefined,
    item: FolderPeek | undefined,
    theme: BoardTheme,
  ): void {
    if (slot === undefined || item === undefined) {
      paper.container.visible = false;
      paper.picture.visible = false;
      paper.loadedPath = "";
      return;
    }

    const box: Rect = { x: slot.x, y: slot.y, width: slot.w, height: slot.h };
    const radius = this.paperRadius();
    paper.box = box;
    paper.container.rotation = slot.lean;
    paper.surface.clear().roundRect(0, 0, box.width, box.height, radius);
    paper.surface.fill({ color: paperColor(item.kind, theme) });
    // Stencilled, never drawn: the colour is irrelevant, the shape is not.
    paper.clip.clear().roundRect(0, 0, box.width, box.height, radius).fill({ color: 0xffffff });

    const url =
      item.kind === "visual" && depth < PAPER_PICTURES ? this.deps.fileUrl(item.path) : null;
    if (url === null) {
      paper.picture.visible = false;
      paper.loadedPath = "";
      return;
    }

    if (paper.loadedPath !== item.path) {
      paper.loadedPath = item.path;
      void this.loadPaper(paper, item, url);
    }
    layoutPicture(paper.picture, box);
  }

  /**
   * Where each sheet is, and how much of it is there. The sheets do not move: the
   * cards that come out of them are drawn at the sheets' own places and travel
   * from there, so a sheet sliding out as well would be the same item leaving
   * twice. It fades instead, and fades back as its card comes home.
   */
  private placePapers(): void {
    const sheets = this.drawnCount();
    this.papers.forEach((paper, depth) => {
      paper.container.position.set(paper.box.x, paper.box.y);
      paper.container.visible = !paper.gone && depth < sheets;
    });
  }

  /** How many sheets are drawn, whether or not the folder is open at the moment. */
  private drawnCount(): number {
    const data = this.data;
    if (data === null) return 0;
    return drawnSheets(data.peek.length, this.height);
  }

  /**
   * Each sheet is taken away the instant its own card starts out of the folder,
   * and is put back the instant that card lands on it again. Not a fade: the card
   * covers the sheet exactly and lies directly under it, so the swap is the same
   * rectangle changing hands and what travels out is read as the sheet itself. A
   * sheet that dissolved while a card flew out of the same place would be the
   * copy this is at pains not to be.
   *
   * One turn per sheet, so the folder empties and fills an item at a time — which
   * is what makes the block beside it read as having been pulled out of here.
   *
   * A swap started while one is waiting takes it over, so a folder opened part of
   * the way through closing keeps the paper it still has.
   *
   * The first draw sets the resting state outright: a folder that appears already
   * open has nothing to animate from.
   */
  private swapPapers(opened: boolean): void {
    const settled = this.paperSettled;
    this.paperSettled = true;
    if (!settled) {
      this.paperTarget = opened;
      for (const paper of this.papers) paper.gone = opened;
      this.placePapers();
      return;
    }
    // Where they are heading, not where they are: the way back waits for the
    // cards, so a folder re-opened in that moment has paper that is still all
    // there and a swap that is still coming for it.
    if (this.paperTarget === opened) return;
    this.paperTarget = opened;

    const generation = (this.paperSwap += 1);
    const total = this.data?.peek.length ?? this.papers.length;
    const now = performance.now();
    this.papers.forEach((paper, depth) => {
      const at = now + this.paperWait(depth, total, opened);
      this.animate((frame) => {
        if (this.paperSwap !== generation) return true;
        if (frame < at) return false;
        paper.gone = opened;
        this.placePapers();
        return true;
      });
    });
  }

  /**
   * When this sheet's turn comes. Going out it is the moment the card printed on
   * it starts moving; coming back it is the moment that card lands on it, which is
   * a frame before the card is taken off the board — the sheet is back under it
   * while it is still there, so neither a gap nor a sheet in an empty folder.
   *
   * The back sheet of a fat folder stands for every item past the fan, so it goes
   * as the first of them leaves and is back for the first of them to return —
   * which, the way out being reversed, is the very last item in the folder.
   */
  private paperWait(depth: number, total: number, opened: boolean): number {
    if (opened) return sheetStagger(depth, total);
    const last = depth === this.drawnCount() - 1 ? total - 1 : depth;
    return sheetReturn(total - 1 - last, total) + TRAVEL_MS;
  }

  /**
   * A file that cannot be read keeps the blank paper it already had, which says
   * more than a broken frame would.
   */
  private async loadPaper(paper: Paper, item: FolderPeek, url: string): Promise<void> {
    paper.picture.visible = false;
    paper.picture.texture = Texture.EMPTY;

    let texture: Texture;
    try {
      // A clip in the folder is a still of itself: the board is what plays it,
      // and a thumbnail running behind a folder's front panel is noise.
      texture = await loadTexture(url, item.path, {
        video: isVideoPath(item.path),
        autoPlay: false,
      });
    } catch {
      return;
    }
    // The paper may have been re-pointed at another item while the bytes loaded.
    if (paper.loadedPath !== item.path) return;

    paper.picture.texture = texture;
    paper.picture.visible = true;
    layoutPicture(paper.picture, paper.box);
  }

  /** The panel the badge and the name sit on, covering all but the paper's edge. */
  private drawFront(theme: BoardTheme): void {
    this.traceFront(this.front.clear());
    this.front.fill({ color: theme.cardRaised });
  }

  /** Where the badge is, so what is drawn and what can be pressed agree. */
  private badgeCircle(): { x: number; y: number; radius: number } {
    const radius = Math.min(BADGE_RADIUS, this.width / 8, this.height / 8);
    return { x: CARD_TYPE.padding + radius, y: CARD_TYPE.padding + radius, radius };
  }

  /**
   * The one kind a drop lands in: a folder is a directory, so a card let go on it
   * is moved into that directory (PLAN §5). Every other card would leave the
   * dragged one exactly where it was.
   */
  acceptsDrop(): boolean {
    return true;
  }

  /**
   * The pointer over the badge, in world units, or null once it has left the
   * card. Answers whether it is on the badge, which is what the tool turns into a
   * hand cursor.
   */
  hoverAt(point: Point | null): boolean {
    const hot = point !== null && this.onBadge(point.x, point.y);
    if (hot === this.badgeHot) return hot;
    this.badgeHot = hot;
    this.drawBadge(this.deps.theme());
    return hot;
  }

  /** Pressing the badge goes into the folder; pressing the card itself does not. */
  pressAt(worldX: number, worldY: number): boolean {
    const data = this.data;
    if (!data || !this.onBadge(worldX, worldY)) return false;
    this.deps.enter(data);
    return true;
  }

  private onBadge(worldX: number, worldY: number): boolean {
    const bounds = this.bounds();
    const badge = this.badgeCircle();
    return Math.hypot(worldX - bounds.x - badge.x, worldY - bounds.y - badge.y) <= badge.radius;
  }

  /** A disc with an arrow out of it: the folder can be gone into. */
  private drawBadge(theme: BoardTheme): void {
    const { x: centreX, y: centreY, radius } = this.badgeCircle();
    const arm = radius * 0.4;

    this.badge
      .clear()
      .circle(centreX, centreY, radius)
      .fill({ color: this.badgeHot ? theme.borderStrong : theme.border });
    this.badge
      .moveTo(centreX, centreY + arm)
      .lineTo(centreX, centreY - arm)
      .moveTo(centreX - arm * 0.72, centreY - arm * 0.28)
      .lineTo(centreX, centreY - arm)
      .lineTo(centreX + arm * 0.72, centreY - arm * 0.28)
      .stroke({
        width: Math.max(1, radius * 0.16),
        color: theme.dim,
        cap: "round",
        join: "round",
      });
  }

  private drawLabel(data: FolderObject, theme: BoardTheme): void {
    const pad = CARD_TYPE.padding;
    const column = Math.max(1, this.width * FOLDER_FRONT_WIDTH - pad * 2);
    const gap = Math.round(CARD_TYPE.metaSize * 1.6);

    // Name, then count: the name is what the folder is, and the count is a note
    // about it rather than a heading over it.
    const runs: TextRun[] = [
      {
        text: data.title ?? data.name,
        size: CARD_TYPE.titleSize - 3,
        color: theme.text,
        weight: 600,
        family: SANS,
        lineHeight: Math.round((CARD_TYPE.titleSize - 3) * 1.25),
        maxLines: 2,
        gapAfter: 4,
      },
      {
        text: data.count === 1 ? "1 Item" : `${data.count} Items`,
        size: CARD_TYPE.metaSize,
        color: theme.dim,
        family: SANS,
        lineHeight: gap,
        maxLines: 1,
      },
    ];

    const baked = this.bake(`folder:${data.id}`, runs, column);
    this.label.texture = baked.texture;
    this.label.setSize(baked.width, baked.height);
    this.label.position.set(pad, this.height - pad - baked.height);
  }

  private bake(key: string, runs: TextRun[], width: number): BakedText {
    return this.deps.textures.get(`${themeRevision()}:${key}`, runs, width, this.resolution);
  }
}

/**
 * The paper the item is printed on. It is what shows through a transparent
 * picture, and all that shows of anything that is not one: a note's own words
 * would be under the panel, so the sheet stands for it.
 */
function paperColor(kind: CardKind, theme: BoardTheme): number {
  if (kind === "folder") return theme.border;
  return theme.card;
}

/**
 * Fills the paper with the picture, cropped rather than letterboxed, and pinned
 * to its top edge: what shows past the panel is the picture's top right, which
 * is nearer its subject than its bottom corner.
 */
function layoutPicture(picture: Sprite, box: Rect): void {
  const texture = picture.texture;
  if (!picture.visible || texture.width === 0 || texture.height === 0) return;

  const ratio = texture.width / texture.height;
  const boxRatio = box.height > 0 ? box.width / box.height : 1;
  const drawWidth = ratio > boxRatio ? box.height * ratio : box.width;
  const drawHeight = ratio > boxRatio ? box.height : box.width / ratio;

  picture.setSize(drawWidth, drawHeight);
  picture.position.set((box.width - drawWidth) / 2, 0);
}

export function folderKind(deps: FolderDeps): CanvasObjectKind<FolderObject> {
  return {
    kind: "folder",
    parse: parseFolder,
    createRenderer: (engine: CanvasEngineApi): CanvasObjectRenderer<FolderObject> =>
      new FolderCardRenderer(engine, deps),
    activate: (object: FolderObject, gesture: ActivationGesture): void => {
      if (gesture === "doubleClick") deps.enter(object);
      else deps.preview(object);
    },
  };
}
