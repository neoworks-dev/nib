/**
 * A sticky: a short note on a square of coloured paper, turned a degree or two
 * on the table. The markdown is drawn as what it means — headings, bullets,
 * numbers, bold and struck-through words, and a task as a box that can be ticked
 * — because a note is read on the card far more often than it is opened.
 *
 * The card grows to the note rather than clipping it: a sticky is as tall as
 * what is written on it, down to a minimum, so nothing is hidden behind an edge.
 */

import type {
  ActivationGesture,
  CanvasEngineApi,
  CanvasObjectKind,
  CanvasObjectRenderer,
  Point,
} from "@nib-ui/ui-contracts";
import { Graphics, Sprite } from "pixi.js";
import { type StickyObject, STICKY_SIZE, parseSticky } from "../board-view";
import {
  type BakedText,
  SANS,
  type TextRun,
  type TextTextureCache,
} from "../engine/utils/textTexture";
import {
  CHECKBOX_GAP,
  CHECKBOX_REACH,
  CHECKBOX_SIZE,
  type StickyLine,
  STICKY_TYPE,
  stickyLines,
  stickyTitleRun,
} from "../sticky-page";
import {
  type BoardTheme,
  CARD_TYPE,
  STICKY_COLORS,
  STICKY_INK,
  stickyTilt,
  themeRevision,
} from "../theme";
import { CardRenderer } from "./CardRenderer";

/**
 * World units between the title and the body. One body line: in the file the
 * heading is followed by a blank line, and that is what the overlay shows while
 * the note is being written.
 */
const TITLE_GAP = Math.round(STICKY_TYPE.body * 1.5);
const BULLET_RADIUS = 2.5;
/**
 * How short a note is allowed to get. A card follows its content, but a one-line
 * note collapsed to a strip of paper stops reading as a note at board zoom.
 */
const STICKY_MIN_HEIGHT = Math.round(STICKY_SIZE.w * 0.6);

export interface StickyDeps {
  theme(): BoardTheme;
  textures: TextTextureCache;
  /** A double click edits the sticky in place. */
  edit(sticky: StickyObject): void;
  /**
   * A checkbox was pressed, by the line it is on in the file. Ticking a box is a
   * write to the markdown, so the card reports the press and the vault does it.
   */
  toggleTask(sticky: StickyObject, line: number): void;
  /** A `[[link]]` on the card was clicked: the board opens what it points at. */
  openLink(sticky: StickyObject, target: string): void;
}

/** Where a task's box was drawn, so a press can be resolved back to its line. */
interface TaskHit {
  line: number;
  x: number;
  y: number;
}

/** Where a link was drawn, so the words that were clicked are the ones that open. */
interface LinkHit {
  target: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

class StickyCardRenderer extends CardRenderer<StickyObject> {
  private readonly title = new Sprite();
  private readonly marks = new Graphics();
  /** One per body line: each is indented past its own gutter, so they cannot share one. */
  private readonly lines: Sprite[] = [];
  /** The numbers of an ordered list, by the file line each was drawn for. */
  private readonly gutters = new Map<number, Sprite>();
  private taskHits: TaskHit[] = [];
  private linkHits: LinkHit[] = [];

  constructor(
    engine: CanvasEngineApi,
    private readonly deps: StickyDeps,
  ) {
    super(engine);
    this.content.addChild(this.title, this.marks);
  }

  protected theme(): BoardTheme {
    return this.deps.theme();
  }

  /** The note's own colour, from its `color:`; the default is green paper. */
  protected surfaceColor(): number {
    return STICKY_COLORS[this.data?.color ?? "green"].surface;
  }

  /** Turned on the table by an angle that is this note's and does not change. */
  protected override get tilt(): number {
    return stickyTilt(this.data?.path ?? "");
  }

  protected contentSignature(data: StickyObject): string {
    return [data.id, data.title ?? "", data.preview, data.color].join(" ");
  }

  /**
   * A press on a checkbox ticks the task, and a press on a link follows it,
   * rather than either opening the card. Read on the way up by the select tool,
   * so dragging the sticky never ticks a box.
   */
  pressAt(worldX: number, worldY: number): boolean {
    const data = this.data;
    if (!data) return false;

    const local = this.toLocal(worldX, worldY);
    for (const hit of this.taskHits) {
      const withinX =
        local.x >= hit.x - CHECKBOX_REACH && local.x <= hit.x + CHECKBOX_SIZE + CHECKBOX_REACH;
      const withinY =
        local.y >= hit.y - CHECKBOX_REACH && local.y <= hit.y + CHECKBOX_SIZE + CHECKBOX_REACH;
      if (!withinX || !withinY) continue;
      // The card draws the body it was given, which starts past the heading the
      // title was taken from; the file still has those lines.
      this.deps.toggleTask(data, hit.line + data.offset);
      return true;
    }

    const link = this.linkUnder(local.x, local.y);
    if (link === null) return false;
    this.deps.openLink(data, link.target);
    return true;
  }

  /** The pointer is on a link, which is what turns the cursor into a hand. */
  hoverAt(point: Point | null): boolean {
    if (point === null) return false;
    const local = this.toLocal(point.x, point.y);
    return this.linkUnder(local.x, local.y) !== null;
  }

  private linkUnder(x: number, y: number): LinkHit | null {
    for (const hit of this.linkHits) {
      if (x < hit.x || x > hit.x + hit.width) continue;
      if (y < hit.y || y > hit.y + hit.height) continue;
      return hit;
    }
    return null;
  }

  protected drawContent(): void {
    const data = this.data;
    if (!data) return;

    const pad = CARD_TYPE.padding;
    const column = Math.max(1, this.width - pad * 2);

    // A note that has not named itself gets no headline: the file it is stored in
    // is called `untitled-<stamp>.md`, and drawing that would tell the user only
    // what the app had to call the file it made for them.
    let y = pad;
    if (data.title === null) {
      this.title.visible = false;
    } else {
      const heading = this.bake(`sticky:title:${data.id}`, [stickyTitleRun(data.title)], column);
      this.title.visible = true;
      this.title.texture = heading.texture;
      this.title.setSize(heading.width, heading.height);
      this.title.position.set(pad, y);
      y += heading.height + TITLE_GAP;
    }

    this.drawBody(data, stickyLines(data.preview), pad, column, y);
  }

  private drawBody(
    data: StickyObject,
    lines: readonly StickyLine[],
    pad: number,
    column: number,
    top: number,
  ): void {
    this.marks.clear();
    this.taskHits = [];
    this.linkHits = [];

    let y = top;
    for (const [index, line] of lines.entries()) {
      y += line.gapBefore;
      const baked = this.bake(
        `sticky:line:${data.id}:${line.line}`,
        [line.run],
        Math.max(1, column - line.indent),
      );
      const sprite = this.lineSprite(index);
      sprite.texture = baked.texture;
      sprite.setSize(baked.width, baked.height);
      sprite.position.set(pad + line.indent, y);
      this.collectLinks(baked, pad + line.indent, y);
      this.drawGutter(line, pad, y);
      y += baked.height;
    }

    for (let index = lines.length; index < this.lines.length; index += 1) {
      const sprite = this.lines[index];
      if (sprite) sprite.visible = false;
    }

    this.fitHeight(data, y + pad);
  }

  /**
   * The card takes the height of what is written on it. The placement is the
   * app's own, so this is a write like a resize is: the note stays as tall as it
   * needs to be across a reload, and a line deleted takes its height with it.
   */
  private fitHeight(data: StickyObject, content: number): void {
    const wanted = Math.round(Math.max(STICKY_MIN_HEIGHT, content));
    // A resize moves the edge a unit at a time and the bake rounds, so anything
    // under a unit is noise: acting on it would write on every frame.
    if (Math.abs(wanted - this.height) < 1) return;
    this.engine.updateObject(data.id, { h: wanted });
  }

  /**
   * The words a link was drawn as, in card coordinates. The bake reports where
   * every piece landed, so the clickable area is exactly the text and not the
   * whole line it sits on.
   */
  private collectLinks(baked: BakedText, left: number, top: number): void {
    for (const line of baked.layout.lines) {
      for (const piece of line.pieces) {
        const target = piece.segment?.link;
        if (target === undefined) continue;
        this.linkHits.push({
          target,
          x: left + piece.x,
          y: top + line.y - line.run.size,
          width: piece.width,
          height: line.run.size * 1.2,
        });
      }
    }
  }

  private drawGutter(line: StickyLine, pad: number, y: number): void {
    const gutter = line.gutter;
    if (!gutter) return;

    if (gutter.kind === "task") {
      const boxY = y + (line.run.size - CHECKBOX_SIZE) / 2 + 2;
      this.drawCheckbox(pad, boxY, gutter.done);
      this.taskHits.push({ line: line.line, x: pad, y: boxY });
      return;
    }

    if (gutter.kind === "bullet") {
      this.marks.circle(pad + CHECKBOX_SIZE / 2, y + line.run.size * 0.62, BULLET_RADIUS);
      this.marks.fill({ color: 0x101114, alpha: 0.74 });
      return;
    }

    const baked = this.bake(
      `sticky:number:${gutter.label}`,
      [
        {
          text: gutter.label,
          size: line.run.size,
          color: STICKY_INK.muted,
          family: line.run.family ?? SANS,
          lineHeight: line.run.lineHeight ?? line.run.size,
        },
      ],
      CHECKBOX_SIZE + CHECKBOX_GAP,
    );
    const sprite = this.gutterSprite(line.line);
    sprite.texture = baked.texture;
    sprite.setSize(baked.width, baked.height);
    sprite.position.set(pad, y);
  }

  private gutterSprite(line: number): Sprite {
    let sprite = this.gutters.get(line);
    if (!sprite) {
      sprite = new Sprite();
      this.gutters.set(line, sprite);
      this.content.addChild(sprite);
    }
    sprite.visible = true;
    return sprite;
  }

  private lineSprite(index: number): Sprite {
    let sprite = this.lines[index];
    if (!sprite) {
      sprite = new Sprite();
      this.lines[index] = sprite;
      this.content.addChild(sprite);
    }
    sprite.visible = true;
    return sprite;
  }

  /** Empty is a rounded outline; done is filled solid, with no tick glyph. */
  private drawCheckbox(x: number, y: number, done: boolean): void {
    this.marks.roundRect(x, y, CHECKBOX_SIZE, CHECKBOX_SIZE, 3);
    if (done) {
      this.marks.fill({ color: 0x000000 });
      return;
    }
    this.marks.stroke({ width: 1.5, color: 0x000000, alpha: 0.45 });
  }

  /** The palette is baked into the texture, so a theme switch has to miss the cache. */
  private bake(key: string, runs: TextRun[], width: number): BakedText {
    return this.deps.textures.get(`${themeRevision()}:${key}`, runs, width, this.resolution);
  }
}

export function stickyKind(deps: StickyDeps): CanvasObjectKind<StickyObject> {
  return {
    kind: "sticky",
    parse: parseSticky,
    createRenderer: (engine: CanvasEngineApi): CanvasObjectRenderer<StickyObject> =>
      new StickyCardRenderer(engine, deps),
    activate: (object: StickyObject, gesture: ActivationGesture): void => {
      if (gesture === "doubleClick") deps.edit(object);
    },
  };
}
