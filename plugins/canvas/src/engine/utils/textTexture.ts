import { Texture } from "pixi.js";

export const SANS = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
export const MONO = "ui-monospace, 'Cascadia Code', 'Fira Code', monospace";

export interface TextRun {
  text: string;
  size: number;
  color: string;
  weight?: number;
  italic?: boolean;
  family?: string;
  lineHeight?: number;
  /** Clipped with an ellipsis past this many wrapped lines. Unlimited when unset. */
  maxLines?: number;
  /** Vertical space after the run's last line. */
  gapAfter?: number;
}

export function runFont(run: TextRun): string {
  const style = run.italic ? "italic " : "";
  return `${style}${run.weight ?? 400} ${run.size}px ${run.family ?? SANS}`;
}

function lineHeightOf(run: TextRun): number {
  return run.lineHeight ?? Math.round(run.size * 1.45);
}

/**
 * Greedy word wrap with an ellipsis on the last allowed line. Words longer than
 * the column are broken rather than allowed to overflow the card they sit in.
 */
export function wrapRun(ctx: CanvasRenderingContext2D, run: TextRun, maxWidth: number): string[] {
  ctx.font = runFont(run);
  const lines: string[] = [];

  for (const paragraph of run.text.split("\n")) {
    if (paragraph.trim().length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/).filter((entry) => entry.length > 0)) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line.length > 0) lines.push(line);
      line = word;
      while (ctx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line.length > 0) lines.push(line);
  }

  const limit = run.maxLines;
  if (limit === undefined || lines.length <= limit) return lines;

  const kept = lines.slice(0, limit);
  let last = `${kept[limit - 1] ?? ""}…`;
  while (last.length > 1 && ctx.measureText(last).width > maxWidth) last = `${last.slice(0, -2)}…`;
  kept[limit - 1] = last;
  return kept;
}

export interface TextLayout {
  lines: { text: string; run: TextRun; y: number }[];
  height: number;
}

/** Lays runs out in a column of `width`, top-aligned, and reports the height used. */
export function layoutRuns(
  ctx: CanvasRenderingContext2D,
  runs: TextRun[],
  width: number,
): TextLayout {
  const lines: TextLayout["lines"] = [];
  let y = 0;

  for (const run of runs) {
    const lineHeight = lineHeightOf(run);
    for (const text of wrapRun(ctx, run, width)) {
      lines.push({ text, run, y: y + run.size });
      y += lineHeight;
    }
    y += run.gapAfter ?? 0;
  }
  return { lines, height: Math.ceil(y) };
}

let measureContext: CanvasRenderingContext2D | null = null;

function measurer(): CanvasRenderingContext2D {
  if (measureContext) return measureContext;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context is unavailable");
  measureContext = ctx;
  return ctx;
}

export function measureRuns(runs: TextRun[], width: number): TextLayout {
  return layoutRuns(measurer(), runs, width);
}

/**
 * Pixi textures baked at zoom 1 blur when the board is zoomed in, so the bake
 * resolution steps with the camera instead of being fixed. Three buckets keep
 * the re-bake count down while covering the useful zoom range.
 */
export function resolutionForZoom(zoom: number): number {
  const dpr = globalThis.devicePixelRatio || 1;
  if (zoom <= 1) return dpr;
  if (zoom <= 2) return dpr * 2;
  return dpr * 3;
}

export interface BakedText {
  texture: Texture;
  width: number;
  height: number;
}

/**
 * Text baked to one texture instead of a Pixi `Text` per line. A card body is a
 * dozen lines that change rarely, so this is both faster to draw and sharper
 * than stacking text objects.
 */
export function bakeRuns(runs: TextRun[], width: number, resolution: number): BakedText {
  const layout = measureRuns(runs, width);
  const height = Math.max(1, layout.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * resolution));
  canvas.height = Math.ceil(height * resolution);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context is unavailable");
  ctx.scale(resolution, resolution);
  ctx.textBaseline = "alphabetic";

  for (const line of layout.lines) {
    if (line.text.length === 0) continue;
    ctx.font = runFont(line.run);
    ctx.fillStyle = line.run.color;
    ctx.fillText(line.text, 0, line.y);
  }

  const texture = Texture.from(canvas);
  texture.source.resolution = resolution;
  return { texture, width, height };
}

/**
 * Keyed by content and bake resolution, so a card that has not changed keeps its
 * texture across frames and a zoom step re-bakes only what is on screen.
 */
export class TextTextureCache {
  private readonly entries = new Map<string, BakedText>();

  constructor(private readonly limit = 256) {}

  get(key: string, runs: TextRun[], width: number, resolution: number): BakedText {
    const cacheKey = `${key}|${Math.round(width)}|${resolution}`;
    const hit = this.entries.get(cacheKey);
    if (hit) {
      // Re-inserted so the oldest key is the least recently used one.
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, hit);
      return hit;
    }

    const baked = bakeRuns(runs, width, resolution);
    this.entries.set(cacheKey, baked);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.get(oldest.value)?.texture.destroy(true);
      this.entries.delete(oldest.value);
    }
    return baked;
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.texture.destroy(true);
    this.entries.clear();
  }
}
