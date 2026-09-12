/**
 * A sticky: a short note on a card a shade warmer than the sheet beside it.
 * Bold sans title line, monospace body under it, and a bullet drawn as a task
 * checkbox — an empty rounded square, or a solid black one when it is done.
 *
 * Fixed size. It does not grow to its content: a board of stickies that each
 * resized themselves as they were typed into would never sit still.
 */

import type {
  ActivationGesture,
  CanvasEngineApi,
  CanvasObjectKind,
  CanvasObjectRenderer,
} from "@nib-ui/ui-contracts";
import { Graphics, Sprite } from "pixi.js";
import { type StickyObject, parseSticky } from "../board-view";
import {
  type BakedText,
  MONO,
  SANS,
  type TextRun,
  type TextTextureCache,
} from "../engine/utils/textTexture";
import { parseBlocks } from "../markdown";
import { type BoardTheme, CARD_TYPE, themeRevision } from "../theme";
import { CardRenderer } from "./CardRenderer";

/** World units: the box, the gap to the words beside it, and the grab margin. */
const CHECKBOX_SIZE = 12;
const CHECKBOX_GAP = 9;
const CHECKBOX_REACH = 5;

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
}

/** Where a task's box was drawn, so a press can be resolved back to its line. */
interface TaskHit {
  line: number;
  x: number;
  y: number;
}

class StickyCardRenderer extends CardRenderer<StickyObject> {
  private readonly title = new Sprite();
  private readonly boxes = new Graphics();
  /** One per body line: a task is indented past its box, so they cannot share one. */
  private readonly lines: Sprite[] = [];
  private taskHits: TaskHit[] = [];

  constructor(
    engine: CanvasEngineApi,
    private readonly deps: StickyDeps,
  ) {
    super(engine);
    this.content.addChild(this.title, this.boxes);
  }

  protected theme(): BoardTheme {
    return this.deps.theme();
  }

  /** Warmer than the sheet it sits beside, which is what tells the two apart. */
  protected surfaceColor(theme: BoardTheme): number {
    return theme.cardRaised;
  }

  protected contentSignature(data: StickyObject): string {
    return [data.id, data.title ?? "", data.name, data.preview].join(" ");
  }

  /**
   * A press on a checkbox ticks the task rather than opening the card. Read on
   * the way up by the select tool, so dragging the sticky never ticks a box.
   */
  pressAt(worldX: number, worldY: number): boolean {
    const data = this.data;
    if (!data) return false;

    const bounds = this.bounds();
    const localX = worldX - bounds.x;
    const localY = worldY - bounds.y;

    for (const hit of this.taskHits) {
      const withinX =
        localX >= hit.x - CHECKBOX_REACH && localX <= hit.x + CHECKBOX_SIZE + CHECKBOX_REACH;
      const withinY =
        localY >= hit.y - CHECKBOX_REACH && localY <= hit.y + CHECKBOX_SIZE + CHECKBOX_REACH;
      if (!withinX || !withinY) continue;
      this.deps.toggleTask(data, hit.line);
      return true;
    }
    return false;
  }

  protected drawContent(): void {
    const data = this.data;
    if (!data) return;

    const theme = this.deps.theme();
    const pad = CARD_TYPE.padding;
    const column = Math.max(1, this.width - pad * 2);

    const heading = this.bake(
      `sticky:title:${data.id}`,
      [
        {
          text: data.title ?? data.name,
          size: CARD_TYPE.titleSize,
          color: theme.text,
          weight: 700,
          family: SANS,
          lineHeight: Math.round(CARD_TYPE.titleSize * 1.25),
          maxLines: 2,
        },
      ],
      column,
    );
    this.title.texture = heading.texture;
    this.title.setSize(heading.width, heading.height);
    this.title.position.set(pad, pad);

    this.drawBody(data, theme, pad, column, pad + heading.height + 10);
  }

  private drawBody(
    data: StickyObject,
    theme: BoardTheme,
    pad: number,
    column: number,
    top: number,
  ): void {
    const lineHeight = Math.round(CARD_TYPE.bodySize * 1.6);
    const room = this.height - top - pad;
    // The body line numbers are the ones in the file, so a press reaches the line
    // it was drawn from even where blank lines were dropped from the card.
    const blocks = parseBlocks(data.preview)
      .map((block, line) => ({ block, line }))
      .filter((entry) => entry.block.text.trim().length > 0)
      .slice(0, Math.max(0, Math.floor(room / lineHeight)));

    this.boxes.clear();
    this.taskHits = [];

    let y = top;
    for (const [index, { block, line }] of blocks.entries()) {
      const indented = block.style === "task" || block.style === "list";
      const indent = indented ? CHECKBOX_SIZE + CHECKBOX_GAP : 0;

      if (block.style === "task") {
        const boxY = y + (CARD_TYPE.bodySize - CHECKBOX_SIZE) / 2 + 2;
        this.drawCheckbox(pad, boxY, block.done, theme);
        this.taskHits.push({ line, x: pad, y: boxY });
      }

      const run: TextRun = {
        text: block.text,
        size: CARD_TYPE.bodySize,
        color: block.done ? theme.faint : theme.muted,
        family: MONO,
        lineHeight,
        maxLines: 1,
      };
      const baked = this.bake(
        `sticky:line:${data.id}:${line}:${block.done}`,
        [run],
        Math.max(1, column - indent),
      );
      const sprite = this.lineSprite(index);
      sprite.texture = baked.texture;
      sprite.setSize(baked.width, baked.height);
      sprite.position.set(pad + indent, y);
      y += lineHeight;
    }

    for (let index = blocks.length; index < this.lines.length; index += 1) {
      const sprite = this.lines[index];
      if (sprite) sprite.visible = false;
    }
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
  private drawCheckbox(x: number, y: number, done: boolean, theme: BoardTheme): void {
    this.boxes.roundRect(x, y, CHECKBOX_SIZE, CHECKBOX_SIZE, 3);
    if (done) {
      this.boxes.fill({ color: 0x000000 });
      return;
    }
    this.boxes.stroke({ width: 1.5, color: theme.borderStrong });
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
