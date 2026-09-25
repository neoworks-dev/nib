// The actions a person takes: click, drag, type, press, scroll, wait — plus
// eval and the screenshot, which only look.

import type { Page } from "playwright-core";
import type { Box } from "../snapshot.ts";
import { describeTarget, parseTarget } from "../targets.ts";
import { cardBox, locate, pointOf } from "./locate.ts";

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
 * Press, move, release — the way a person moves a card or resizes a dock.
 *
 * The move is stepped rather than a jump: the board and the dock dividers
 * accumulate pointermove deltas, and one event from start to finish is a drag
 * they never see the middle of.
 */
export async function drag(page: Page, refsPath: string, command: Command): Promise<unknown> {
  const from = await pointOf(page, refsPath, parseTarget(String(command.from)));
  const to = await pointOf(page, refsPath, parseTarget(String(command.to)));
  const steps = Number(command.steps ?? 24);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    await page.mouse.move(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio);
  }
  await page.mouse.up();
  return {
    dragged: `${Math.round(from.x)},${Math.round(from.y)} → ${Math.round(to.x)},${Math.round(to.y)}`,
  };
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
  if (typeof command.target === "string") {
    const target = parseTarget(command.target);
    if (target.kind === "card") {
      await page.screenshot({ path, clip: cardBox(refsPath, target.ref) });
      return { shot: path };
    }
    await locate(page, refsPath, target).screenshot({ path });
    return { shot: path };
  }
  await page.screenshot({ path, clip: cropOf(command) });
  return { shot: path };
}

/** The rectangle a command asked to be photographed, if it asked for one. */
export function cropOf(command: Command): Box | undefined {
  const crop = command.crop as Box | undefined;
  if (!crop) return undefined;
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}
