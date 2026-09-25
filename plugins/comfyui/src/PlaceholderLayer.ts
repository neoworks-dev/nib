/**
 * Draws a placeholder card at each running ComfyUI job's result slot: the board's
 * paper, dashed, with what is running and how far it has got. It sits in world
 * space like the cards themselves, so it pans and zooms with them.
 */

import { Container, Graphics, Text } from "pixi.js";
import type { Placeholder } from "./placeholders";

/** The board's card corner and palette, as the canvas draws its own cards. */
const RADIUS = 12;
const PAPER = 0xffffff;
const BORDER = 0xc9cdd4;
const TITLE = "#16171a";
const MUTED = "#5f6570";
const BAR_TRACK = 0xe2e4e8;
const BAR_FILL = 0x6fd0ff;
const FONT = "Inter, ui-sans-serif, system-ui, sans-serif";

const DASH = 8;
const GAP = 6;
const INSET = 16;
const BAR_HEIGHT = 4;
/** Text is rasterised; drawn at twice its size so it stays sharp when the board zooms in. */
const TEXT_RESOLUTION = 2;

export class PlaceholderLayer {
  readonly container = new Container();
  private signature = "";

  constructor() {
    this.container.eventMode = "none";
  }

  /** Redraws the placeholders, when they differ from what is drawn. */
  draw(placeholders: readonly Placeholder[]): void {
    const signature = JSON.stringify(placeholders);
    if (signature === this.signature) return;
    this.signature = signature;
    this.clear();
    for (const placeholder of placeholders) this.container.addChild(card(placeholder));
  }

  destroy(): void {
    this.clear();
    this.container.destroy();
  }

  /** Removes and frees every placeholder drawn. */
  private clear(): void {
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
  }
}

/** One placeholder card at its slot. */
function card(placeholder: Placeholder): Container {
  const { slot } = placeholder;
  const group = new Container();
  group.position.set(slot.x, slot.y);

  const paper = new Graphics()
    .roundRect(0, 0, slot.w, slot.h, RADIUS)
    .fill({ color: PAPER, alpha: 0.6 });
  group.addChild(paper, dashedOutline(slot.w, slot.h));

  const title = text(placeholder.label, 15, TITLE, slot.w - INSET * 2);
  const detail = text(placeholder.detail, 13, MUTED, slot.w - INSET * 2);
  title.position.set(INSET, slot.h / 2 - title.height);
  detail.position.set(INSET, slot.h / 2 + 4);
  group.addChild(title, detail);

  if (placeholder.progress !== null) {
    group.addChild(progressBar(slot.w, slot.h, placeholder.progress));
  }
  return group;
}

/** The rounded rectangle's outline in dashes, walked side by side. */
function dashedOutline(width: number, height: number): Graphics {
  const outline = new Graphics();
  const sides: [number, number, number, number][] = [
    [RADIUS, 0, width - RADIUS, 0],
    [width, RADIUS, width, height - RADIUS],
    [width - RADIUS, height, RADIUS, height],
    [0, height - RADIUS, 0, RADIUS],
  ];
  for (const [fromX, fromY, toX, toY] of sides) dashes(outline, fromX, fromY, toX, toY);
  return outline.stroke({ width: 1.5, color: BORDER });
}

/** Dashes along one straight side. */
function dashes(outline: Graphics, fromX: number, fromY: number, toX: number, toY: number): void {
  const length = Math.hypot(toX - fromX, toY - fromY);
  if (length === 0) return;
  const stepX = (toX - fromX) / length;
  const stepY = (toY - fromY) / length;
  for (let along = 0; along < length; along += DASH + GAP) {
    const end = Math.min(length, along + DASH);
    outline.moveTo(fromX + stepX * along, fromY + stepY * along);
    outline.lineTo(fromX + stepX * end, fromY + stepY * end);
  }
}

/** The executing node's steps, along the bottom of the card. */
function progressBar(width: number, height: number, progress: number): Graphics {
  const barWidth = width - INSET * 2;
  const top = height - INSET - BAR_HEIGHT;
  const radius = BAR_HEIGHT / 2;
  return new Graphics()
    .roundRect(INSET, top, barWidth, BAR_HEIGHT, radius)
    .fill({ color: BAR_TRACK })
    .roundRect(INSET, top, Math.max(BAR_HEIGHT, barWidth * progress), BAR_HEIGHT, radius)
    .fill({ color: BAR_FILL });
}

/** A line of text, cut short with an ellipsis where it would overflow the card. */
function text(content: string, size: number, color: string, maxWidth: number): Text {
  const line = new Text({
    text: content,
    resolution: TEXT_RESOLUTION,
    style: { fontFamily: FONT, fontSize: size, fill: color },
  });
  let shortened = content;
  while (line.width > maxWidth && shortened.length > 1) {
    shortened = shortened.slice(0, -1);
    line.text = `${shortened.trimEnd()}…`;
  }
  return line;
}
