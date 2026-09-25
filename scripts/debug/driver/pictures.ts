// Taking pictures of the window: one frame, or a strip of them for an animation.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    const frames = request.frames ?? 1;
    if (frames > 1) {
      await photographStrip(page, path, request, frames);
      return;
    }
    const capture = await frameCapturer(page, request);
    await capture(path);
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
  await caughtUp(page, display);
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
 * How long to wait for the display when there is no drawn pointer to watch for.
 * Measured on Xvnc: two animation frames alone still read the frame before.
 */
const DISPLAY_LATENCY_MS = 150;
/** The longest the drawn pointer is waited for before the picture is taken anyway. */
const CATCH_UP_LIMIT_MS = 2000;
/** A point inside the drawn arrow's black body, clear of its white outline. */
const POINTER_INK = { x: 4, y: 9 } as const;

/**
 * Waits until what the last action changed is on the display. Chromium's own
 * capture forces a fresh frame; reading the display does not, and how far the
 * display lags behind varies — further behind while a button is held. So the
 * arrow `showPointer` drew is watched for: once its ink is on the display,
 * everything drawn before it is too. With the pointer off screen there is
 * nothing to watch, and a fixed wait stands in.
 */
async function caughtUp(page: Page, display: string): Promise<void> {
  const ink = await pointerInk(page);
  if (ink === null) {
    await page.waitForTimeout(DISPLAY_LATENCY_MS);
    return;
  }
  const deadline = Date.now() + CATCH_UP_LIMIT_MS;
  while (Date.now() < deadline) {
    if (isDark(display, ink)) return;
    await page.waitForTimeout(20);
  }
}

/** Where on the display the drawn arrow's ink is, or null when the pointer is off the window. */
async function pointerInk(page: Page): Promise<{ x: number; y: number } | null> {
  const where = await page.evaluate(() => ({
    pointer: (window as unknown as PointerWindow).__debug_pointer,
    x: window.screenX,
    y: window.screenY,
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const pointer = where.pointer;
  if (!pointer) return null;
  const inside =
    pointer.x >= 0 && pointer.y >= 0 && pointer.x < where.width && pointer.y < where.height;
  if (!inside) return null;
  return {
    x: Math.round(where.x + pointer.x + POINTER_INK.x),
    y: Math.round(where.y + pointer.y + POINTER_INK.y),
  };
}

/** Whether the display pixel at a point is near black. */
function isDark(display: string, point: { x: number; y: number }): boolean {
  const read = spawnSync(
    "magick",
    [
      "import",
      "-display",
      display,
      "-window",
      "root",
      "-crop",
      `1x1+${point.x}+${point.y}`,
      "-format",
      "%[fx:intensity]",
      "info:",
    ],
    { encoding: "utf8" },
  );
  if (read.status !== 0) return true;
  return Number(read.stdout.trim()) < 0.2;
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

/** How far behind the page the screencast's first frame arrives. Measured on Xvnc: ~130ms. */
const SCREENCAST_LAG_MS = 300;

/** One frame Chromium's screencast delivered, with when it was drawn. */
interface ScreencastFrame {
  seconds: number;
  data: string;
}

/**
 * Records a strip through Chromium's screencast, which streams every frame the
 * page draws. Reading the display is too slow for this — each read takes longer
 * than a frame, and the display takes its updates in bursts — so an animation of
 * a fifth of a second would show as a before and an after. The screencast is
 * passive and, unlike a capture, fires no `mouseleave`. The frame shown at each
 * `interval` is the last one drawn by then.
 */
async function photographStrip(
  page: Page,
  path: string,
  request: PictureRequest,
  frames: number,
): Promise<void> {
  const interval = request.every ?? 50;
  const recorded = await recordScreencast(page, frames * interval);
  const scratch = mkdtempSync(join(tmpdir(), "nib-frames-"));
  try {
    const framePaths = sampleFrames(recorded.frames, recorded.startSeconds, frames, interval).map(
      (frame, index) => {
        const framePath = join(scratch, `${String(index).padStart(3, "0")}.png`);
        writeFileSync(framePath, Buffer.from(frame.data, "base64"));
        return framePath;
      },
    );
    joinFrames(framePaths, path, request.clip);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Every frame the page draws for `durationMs`, and when the recording began. */
async function recordScreencast(
  page: Page,
  durationMs: number,
): Promise<{ frames: ScreencastFrame[]; startSeconds: number }> {
  const session = await page.context().newCDPSession(page);
  const frames: ScreencastFrame[] = [];
  session.on("Page.screencastFrame", (event) => {
    let seconds = Date.now() / 1000;
    if (event.metadata.timestamp !== undefined) seconds = event.metadata.timestamp;
    frames.push({ seconds, data: event.data });
    session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {
      // The recording has stopped; nothing is waiting for the acknowledgement.
    });
  });
  await session.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await page.waitForTimeout(durationMs + SCREENCAST_LAG_MS);
  await session.send("Page.stopScreencast");
  await session.detach().catch(() => undefined);
  const first = frames[0];
  if (first === undefined) throw new Error("the screencast delivered no frames");
  // Timed from the first frame rather than the request: the stream starts with
  // the pipeline's lag, and a strip timed from the request spends its first
  // frames repeating one picture.
  return { frames, startSeconds: first.seconds };
}

/**
 * The frame on screen at each of `count` moments `interval` apart: the last one
 * drawn by then. Chromium only sends a frame when something changed, so a
 * stretch where nothing moved repeats the frame before it.
 */
function sampleFrames(
  frames: readonly ScreencastFrame[],
  startSeconds: number,
  count: number,
  interval: number,
): ScreencastFrame[] {
  const sampled: ScreencastFrame[] = [];
  for (let index = 0; index < count; index += 1) {
    const moment = startSeconds + (index * interval) / 1000;
    let shown = frames[0];
    for (const frame of frames) {
      if (frame.seconds > moment) break;
      shown = frame;
    }
    if (shown !== undefined) sampled.push(shown);
  }
  return sampled;
}

/** Lays frames side by side in one picture, each cropped to the region when one is given. */
function joinFrames(framePaths: readonly string[], path: string, clip: Box | undefined): void {
  const crop: string[] = [];
  if (clip !== undefined) {
    const geometry = `${Math.round(clip.width)}x${Math.round(clip.height)}+${Math.round(clip.x)}+${Math.round(clip.y)}`;
    crop.push("-crop", geometry, "+repage");
  }
  const joined = spawnSync("magick", [...framePaths, ...crop, "+append", path], {
    encoding: "utf8",
  });
  if (joined.status !== 0) {
    throw new Error(`could not join the frames with ImageMagick: ${joined.stderr}`);
  }
}
