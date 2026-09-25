// Taking pictures of the window: one frame, or a strip of them for an animation.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import type { Box } from "../snapshot.ts";

export interface PictureRequest {
  /** Only this region of the window, when set. */
  clip?: Box;
  /** How many frames; more than one makes a strip. */
  frames?: number;
  /** Milliseconds between frames, at least — each capture takes time of its own. */
  every?: number;
  /** The X display the app is on, read directly so Chromium never notices the picture. */
  display?: string;
}

interface PointerWindow {
  __debug_pointer?: { x: number; y: number };
}

/**
 * Keep the pointer's last position on `window`, once. A screenshot has no
 * cursor in it, and a picture of a hover or a drag says little without one; the
 * position outlives the connection, like the console buffer.
 */
export async function installPointerTracking(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const view = window as unknown as PointerWindow;
      if (view.__debug_pointer) return;
      view.__debug_pointer = { x: -100, y: -100 };
      window.addEventListener(
        "pointermove",
        (event) => {
          view.__debug_pointer = { x: event.clientX, y: event.clientY };
        },
        true,
      );
    })
    .catch(() => undefined);
}

/**
 * Photographs the window into `path`: one frame, or with `frames` a strip of them
 * laid side by side in one file, so an animation reads left to right. The
 * pointer is drawn in, where the app last saw it.
 */
export async function photograph(page: Page, path: string, request: PictureRequest): Promise<void> {
  await showPointer(page);
  try {
    const capture = await frameCapturer(page, request);
    const frames = request.frames ?? 1;
    if (frames <= 1) {
      await capture(path);
      return;
    }
    await photographStrip(page, path, capture, frames, request.every ?? 50);
  } finally {
    await hidePointer(page);
  }
}

/** Writes one frame of the picture being taken to a path. */
type FrameCapturer = (path: string) => Promise<void>;

/**
 * How the frames of this picture are taken: read off the X display rather than
 * out of Chromium. Any capture Chromium takes itself — `page.screenshot` or
 * CDP's — makes it fire `mouseleave` at the document, and everything that shows
 * under a resting pointer — a plus button, a hover lift — is gone from every
 * picture after the first and from the app once the driver leaves. Falls back
 * to Playwright when no display was handed over.
 */
async function frameCapturer(page: Page, request: PictureRequest): Promise<FrameCapturer> {
  const display = request.display;
  if (display === undefined) {
    return async (path) => {
      await page.screenshot({ path, clip: request.clip });
    };
  }
  await nextPaint(page);
  const region = await screenRegion(page, request.clip);
  const geometry = `${region.width}x${region.height}+${region.x}+${region.y}`;
  return (path) => {
    const grabbed = spawnSync(
      "magick",
      ["import", "-display", display, "-window", "root", "-crop", geometry, "+repage", path],
      { encoding: "utf8" },
    );
    if (grabbed.status !== 0) {
      throw new Error(`could not read the display with ImageMagick: ${grabbed.stderr}`);
    }
    return Promise.resolve();
  };
}

/**
 * How long a composited frame takes to reach the X display after Chromium has
 * drawn it. Measured on Xvnc: two animation frames alone still read the frame
 * before.
 */
const DISPLAY_LATENCY_MS = 150;

/**
 * Waits until what the last action changed is on the display. Chromium's own
 * capture forces a fresh frame; reading the display does not, so it waits two
 * animation frames — one for the board to draw, one for that to be composited —
 * and then for the display to catch up.
 */
async function nextPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.waitForTimeout(DISPLAY_LATENCY_MS);
}

/** A region of the page — the whole viewport when none is given — in display pixels. */
async function screenRegion(page: Page, clip: Box | undefined): Promise<Box> {
  const origin = await page.evaluate(() => ({
    x: window.screenX,
    y: window.screenY,
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  let region: Box = { x: 0, y: 0, width: origin.width, height: origin.height };
  if (clip !== undefined) region = clip;
  return {
    x: Math.round(origin.x + region.x),
    y: Math.round(origin.y + region.y),
    width: Math.round(region.width),
    height: Math.round(region.height),
  };
}

/** Draws an arrow cursor at the pointer's last position, above everything and unclickable. */
async function showPointer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const position = (window as unknown as PointerWindow).__debug_pointer;
    if (!position) return;
    const marker = document.createElement("div");
    marker.id = "__debug_pointer";
    marker.style.cssText = `position:fixed;left:${position.x}px;top:${position.y}px;z-index:2147483647;pointer-events:none;width:16px;height:22px`;
    marker.innerHTML =
      '<svg width="16" height="22" viewBox="0 0 16 22"><path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" fill="black" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.append(marker);
  });
}

/** Takes the cursor drawn by `showPointer` out again. */
async function hidePointer(page: Page): Promise<void> {
  await page
    .evaluate(() => document.getElementById("__debug_pointer")?.remove())
    .catch(() => {
      // The page went away with the picture taken; there is no cursor left to remove.
    });
}

/** Takes the frames of a strip into a scratch directory and joins them with ImageMagick. */
async function photographStrip(
  page: Page,
  path: string,
  capture: FrameCapturer,
  frames: number,
  interval: number,
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "nib-frames-"));
  const framePaths: string[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    if (frame > 0) await page.waitForTimeout(interval);
    const framePath = join(scratch, `${String(frame).padStart(3, "0")}.png`);
    await capture(framePath);
    framePaths.push(framePath);
  }
  const joined = spawnSync("magick", [...framePaths, "+append", path], { encoding: "utf8" });
  rmSync(scratch, { recursive: true, force: true });
  if (joined.status !== 0) {
    throw new Error(`could not join the frames with ImageMagick: ${joined.stderr}`);
  }
}
