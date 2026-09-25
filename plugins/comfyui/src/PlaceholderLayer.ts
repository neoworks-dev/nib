/**
 * Draws a placeholder card at each running ComfyUI job's result slot: a card
 * with an image's rounded corners, filled with a grid of dots that a wave runs
 * through while the job works, what is running along the bottom, and the line
 * from the pictures it was given that its result will keep. It sits in world
 * space like the cards themselves, so it pans and zooms with them.
 */

import type { Rect } from "@nib-ui/ui-contracts";
import { Container, Graphics, Text } from "pixi.js";
import { lineageCurve } from "./lineage";
import type { Placeholder } from "./placeholders";

/** An image card's corner, as the media renderer draws it. */
const RADIUS = 10;
const PAPER = 0xf3f4f6;
const DOT = 0x8a909a;
const TITLE = "#16171a";
const MUTED = "#5f6570";
const BAR_TRACK = 0xe2e4e8;
const BAR_FILL = 0x6fd0ff;
const LINE_COLOR = 0x9aa0a9;
const LINE_WIDTH = 2;
const LINE_END_RADIUS = 4;
const FONT = "Inter, ui-sans-serif, system-ui, sans-serif";

/** World units between dot centres, and the dots' resting and crest radii. */
const DOT_SPACING = 18;
const DOT_RADIUS = 1.4;
const DOT_CREST_RADIUS = 3;
const DOT_REST_ALPHA = 0.25;
/** The wave: world units between crests, and how fast it travels. */
const WAVELENGTH = 220;
const WAVE_SPEED = 0.12;
/** Space along the bottom kept free of dots for the label. */
const FOOTER = 52;
const INSET = 14;
const BAR_HEIGHT = 4;
/** Text is rasterised; drawn at twice its size so it stays sharp when the board zooms in. */
const TEXT_RESOLUTION = 2;

/** One drawn placeholder: its dot field is redrawn every frame. */
interface DrawnCard {
  dots: Graphics;
  width: number;
  height: number;
}

export class PlaceholderLayer {
  readonly container = new Container();
  private readonly lines = new Container();
  private readonly cards = new Container();
  private drawn: DrawnCard[] = [];
  private signature = "";
  private frame: number | null = null;
  private readonly still = prefersReducedMotion();

  constructor() {
    this.container.eventMode = "none";
    this.container.addChild(this.lines, this.cards);
  }

  /** Redraws the placeholders, when they differ from what is drawn, and runs the wave while any show. */
  draw(placeholders: readonly Placeholder[]): void {
    const signature = JSON.stringify(placeholders);
    if (signature === this.signature) return;
    this.signature = signature;
    this.clear();
    for (const placeholder of placeholders) {
      for (const source of placeholder.sources) this.lines.addChild(link(source, placeholder));
      const drawn = card(placeholder);
      this.cards.addChild(drawn.group);
      this.drawn.push(drawn.card);
    }
    this.animate(performance.now());
  }

  destroy(): void {
    this.stop();
    this.clear();
    this.container.destroy({ children: true });
  }

  /** Moves the wave on a frame, and asks for the next one while there is anything to move. */
  private animate(time: number): void {
    this.frame = null;
    for (const drawn of this.drawn) drawDots(drawn, time);
    if (this.drawn.length === 0 || this.still) return;
    this.frame = requestAnimationFrame((next) => this.animate(next));
  }

  private stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /** Removes and frees every placeholder drawn. */
  private clear(): void {
    this.stop();
    this.drawn = [];
    for (const child of this.lines.removeChildren()) child.destroy({ children: true });
    for (const child of this.cards.removeChildren()) child.destroy({ children: true });
  }
}

/** Whether the system asks for no animation; the dots then stay still. */
function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One placeholder card at its slot, and its dot field to animate. */
function card(placeholder: Placeholder): { group: Container; card: DrawnCard } {
  const { slot } = placeholder;
  const group = new Container();
  group.position.set(slot.x, slot.y);

  const paper = new Graphics().roundRect(0, 0, slot.w, slot.h, RADIUS).fill({ color: PAPER });
  const dots = new Graphics();
  const mask = new Graphics().roundRect(0, 0, slot.w, slot.h, RADIUS).fill({ color: 0xffffff });
  dots.mask = mask;
  group.addChild(paper, dots, mask);

  const title = text(placeholder.label, 13, TITLE, slot.w - INSET * 2);
  const detail = text(placeholder.detail, 11, MUTED, slot.w - INSET * 2);
  const top = slot.h - FOOTER + 8;
  title.position.set(INSET, top);
  detail.position.set(INSET, top + title.height + 2);
  group.addChild(title, detail);

  if (placeholder.progress !== null) {
    group.addChild(progressBar(slot.w, slot.h, placeholder.progress));
  }
  return { group, card: { dots, width: slot.w, height: slot.h } };
}

/**
 * The dot grid at a moment: a diagonal wave travels through it, lifting each dot
 * it passes in size and strength, so the card reads as work under way.
 */
function drawDots(drawn: DrawnCard, time: number): void {
  const { dots, width, height } = drawn;
  const fieldHeight = Math.max(DOT_SPACING, height - FOOTER);
  const columns = Math.floor(width / DOT_SPACING);
  const rows = Math.floor(fieldHeight / DOT_SPACING);
  const offsetX = (width - (columns - 1) * DOT_SPACING) / 2;
  const offsetY = (fieldHeight - (rows - 1) * DOT_SPACING) / 2;
  dots.clear();
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = offsetX + column * DOT_SPACING;
      const y = offsetY + row * DOT_SPACING;
      const lift = waveAt(x, y, time);
      dots
        .circle(x, y, DOT_RADIUS + (DOT_CREST_RADIUS - DOT_RADIUS) * lift)
        .fill({ color: DOT, alpha: DOT_REST_ALPHA + (1 - DOT_REST_ALPHA) * lift });
    }
  }
}

/** How high the wave stands at a point, from 0 in the trough to 1 on the crest, sharpened so crests read as a band. */
function waveAt(x: number, y: number, time: number): number {
  const phase = ((x + y * 0.6 - time * WAVE_SPEED) / WAVELENGTH) * Math.PI * 2;
  const height = (Math.sin(phase) + 1) / 2;
  return height ** 3;
}

/** The line from a source picture to the placeholder, as the lineage link to its result will run. */
function link(source: Rect, placeholder: Placeholder): Graphics {
  const { slot } = placeholder;
  const target = { x: slot.x, y: slot.y, width: slot.w, height: slot.h };
  const { start, startHandle, endHandle, end } = lineageCurve(source, target);
  return new Graphics()
    .moveTo(start.x, start.y)
    .bezierCurveTo(startHandle.x, startHandle.y, endHandle.x, endHandle.y, end.x, end.y)
    .stroke({ width: LINE_WIDTH, color: LINE_COLOR })
    .circle(start.x, start.y, LINE_END_RADIUS)
    .circle(end.x, end.y, LINE_END_RADIUS)
    .fill({ color: LINE_COLOR });
}

/** The executing node's steps, along the bottom of the card. */
function progressBar(width: number, height: number, progress: number): Graphics {
  const barWidth = width - INSET * 2;
  const top = height - INSET - BAR_HEIGHT + 6;
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
