// The actions a person takes: click, drag, type, press, scroll, wait — plus
// eval and the screenshot, which only look.

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { Page } from "playwright-core";
import type { Box } from "../snapshot.ts";
import { describeTarget, parseTarget } from "../targets.ts";
import { cardBox, locate, pointOf } from "./locate.ts";
import { type PictureRequest, photograph } from "./pictures.ts";

export interface Command {
  action: string;
  [key: string]: unknown;
}

/** Click a target: an element through Playwright, a card or point with the mouse. */
export async function click(page: Page, refsPath: string, command: Command): Promise<unknown> {
  const target = parseTarget(String(command.target));
  let button: "left" | "right" | "middle" = "left";
  if (command.button === "right" || command.button === "middle") button = command.button;
  const clickCount = Number(command.count ?? 1);

  if (target.kind === "point" || target.kind === "card") {
    const point = await pointOf(page, refsPath, target);
    await page.mouse.click(point.x, point.y, { button, clickCount });
    return { clicked: describeTarget(target) };
  }
  await locate(page, refsPath, target).click({ button, clickCount, timeout: 15_000 });
  return { clicked: describeTarget(target) };
}

/**
 * How long the pointer rests on the start of a drag before pressing. What only
 * appears under a resting pointer — a card's plus button, its resize grips — has
 * to be there before the press, or the press lands on the card instead.
 */
const DRAG_SETTLE_MS = 150;

/** Photographs the screen mid-gesture, for a drag that asked to be seen held. */
export type Photographer = () => Promise<void>;

/**
 * Press, move, release — the way a person moves a card or resizes a dock.
 *
 * The move is stepped rather than a jump: the board and the dock dividers
 * accumulate pointermove deltas, and one event from start to finish is a drag
 * they never see the middle of. With `hold`, the picture is taken at the end of
 * the move with the button still down — what a drag looks like while it lasts.
 */
export async function drag(
  page: Page,
  refsPath: string,
  command: Command,
  photograph: Photographer,
): Promise<unknown> {
  const from = await pointOf(page, refsPath, parseTarget(String(command.from)));
  const to = await pointOf(page, refsPath, parseTarget(String(command.to)));
  const steps = Number(command.steps ?? 24);

  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(DRAG_SETTLE_MS);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    await page.mouse.move(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio);
  }
  if (command.hold === true) await photograph();
  await page.mouse.up();
  return {
    dragged: `${Math.round(from.x)},${Math.round(from.y)} → ${Math.round(to.x)},${Math.round(to.y)}`,
  };
}

/**
 * Move the pointer onto a target and leave it there, for what shows only under
 * a resting pointer. The renderer keeps the position after the driver leaves.
 */
export async function hover(page: Page, refsPath: string, command: Command): Promise<unknown> {
  const target = parseTarget(String(command.target));
  if (target.kind === "point" || target.kind === "card") {
    const point = await pointOf(page, refsPath, target);
    await page.mouse.move(point.x, point.y);
    return { hovering: describeTarget(target) };
  }
  await locate(page, refsPath, target).hover({ timeout: 15_000 });
  return { hovering: describeTarget(target) };
}

/** Files pasted as a picture rather than as their text. */
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

/**
 * Put a file on the system clipboard and press Ctrl+V, over a target when one
 * is given. The clipboard is written from the renderer, so the paste that
 * follows is a real one: Chromium reads it back from the X display's clipboard
 * the way it does anything a person copied. Pictures go on as PNG, the one
 * image type Chromium's clipboard takes; anything else goes on as text.
 */
export async function paste(page: Page, refsPath: string, command: Command): Promise<unknown> {
  const file = String(command.file);
  const isImage = IMAGE_EXTENSIONS.includes(extname(file).toLowerCase());
  let pastedAs = "text/plain";
  if (isImage) {
    await writeClipboardImage(page, readFileSync(file));
    pastedAs = "image/png";
  } else {
    await writeClipboardText(page, readFileSync(file, "utf8"));
  }
  if (typeof command.target === "string") {
    await hover(page, refsPath, { action: "hover", target: command.target });
  }
  await page.keyboard.press("Control+v");
  return { pasted: basename(file), as: pastedAs };
}

/** Writes text to the system clipboard from the renderer. */
async function writeClipboardText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
}

/**
 * Writes a picture to the system clipboard from the renderer, as PNG whatever
 * it was on disk: it is decoded into a bitmap and encoded again on the way.
 */
async function writeClipboardImage(page: Page, bytes: Buffer): Promise<void> {
  await page.evaluate(async (base64) => {
    const source = await fetch(`data:application/octet-stream;base64,${base64}`);
    const bitmap = await createImageBitmap(await source.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  }, bytes.toString("base64"));
}

/** Type into whatever has focus, a keystroke at a time. */
export async function type(page: Page, command: Command): Promise<unknown> {
  const text = String(command.text);
  await page.keyboard.type(text, { delay: 20 });
  return { typed: text.length };
}

/** Press keys or chords in order: `Escape`, `Control+s`. */
export async function key(page: Page, command: Command): Promise<unknown> {
  let keys = [String(command.keys)];
  if (Array.isArray(command.keys)) keys = command.keys.map(String);
  for (const chord of keys) await page.keyboard.press(chord, { delay: 20 });
  return { pressed: keys };
}

/** Wheel, over a target when one is given. On the board this zooms or pans. */
export async function scroll(page: Page, refsPath: string, command: Command): Promise<unknown> {
  if (typeof command.target === "string") {
    const point = await pointOf(page, refsPath, parseTarget(command.target));
    await page.mouse.move(point.x, point.y);
  }
  const deltaX = Number(command.dx ?? 0);
  const deltaY = Number(command.dy ?? 0);
  await page.mouse.wheel(deltaX, deltaY);
  return { scrolled: { deltaX, deltaY } };
}

/** Wait for a target to appear, or to go away. */
export async function wait(page: Page, refsPath: string, command: Command): Promise<unknown> {
  const target = parseTarget(String(command.target));
  const gone = command.gone === true;
  let state: "hidden" | "visible" = "visible";
  if (gone) state = "hidden";
  await locate(page, refsPath, target).waitFor({
    state,
    timeout: Number(command.timeout ?? 20_000),
  });
  return { [state]: describeTarget(target) };
}

/**
 * One expression in the renderer, awaited, JSON on the way out — Svelte's
 * $state values are proxies and do not survive structured cloning.
 */
export async function evaluate(page: Page, command: Command): Promise<unknown> {
  const expression = String(command.expression);
  const json = await page.evaluate<string | null>(
    `Promise.resolve((() => (${expression}))()).then((value) => JSON.stringify(value === undefined ? null : value))`,
  );
  if (json === null || json === undefined) return null;
  return JSON.parse(json);
}

/** A screenshot of the window, a region of it, or one target. */
export async function shot(page: Page, refsPath: string, command: Command): Promise<unknown> {
  const path = String(command.path);
  const request = pictureRequest(command);
  if (typeof command.target === "string") {
    request.clip = await targetBox(page, refsPath, command.target);
  }
  await photograph(page, path, request);
  return { shot: path };
}

/** The window rectangle a card or an element takes up, for a picture of just it. */
async function targetBox(page: Page, refsPath: string, targetText: string): Promise<Box> {
  const target = parseTarget(targetText);
  if (target.kind === "card") return cardBox(refsPath, target.ref);
  const box = await locate(page, refsPath, target).boundingBox({ timeout: 15_000 });
  if (box === null) throw new Error(`${describeTarget(target)} is not on screen`);
  return box;
}

/** The framing, and the frame count for a strip, a command asked its picture to have. */
export function pictureRequest(command: Command): PictureRequest {
  const request: PictureRequest = {
    clip: cropOf(command),
    frames: Number(command.frames ?? 1),
    every: Number(command.every ?? 50),
  };
  if (typeof command.display === "string") request.display = command.display;
  return request;
}

/** The rectangle a command asked to be photographed, if it asked for one. */
export function cropOf(command: Command): Box | undefined {
  const crop = command.crop as Box | undefined;
  if (!crop) return undefined;
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}
