import { Texture } from "pixi.js";

export const SANS = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
export const MONO = "ui-monospace, 'Cascadia Code', 'Fira Code', monospace";

/**
 * A stretch of a run drawn differently from the rest of it: the bold words in a
 * sentence, the struck-through ones. Everything a segment does not say it takes
 * from the run it belongs to.
 */
export interface TextSegment {
  text: string;
  weight?: number;
  italic?: boolean;
  strike?: boolean;
  /** Code is set in the mono face while the prose around it stays sans. */
  family?: string;
  /** Overrides the run's ink — a link is drawn in the link colour. */
  color?: string;
  /**
   * What this stretch points at. Nothing here draws it; it travels with the
   * segment so a card can find the piece again and make it clickable.
   */
  link?: string;
}

export interface TextRun {
  text: string;
  /**
   * The same text, split into the pieces it is styled in. `text` stays the plain
   * reading of it — it is what the wrap and the cache key are built from — so a
   * caller that sets this has to keep the two in step; `segmentedRun` does.
   */
  segments?: TextSegment[];
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
  /**
   * Vertical space before the run's first line. A heading needs more air above
   * it than the paragraph it closes needs below it, and only the heading knows
   * that — the run in front of it has no idea what follows.
   */
  gapBefore?: number;
  /**
   * Drawn with its own spacing kept, one source line per drawn line. A table is
   * laid out by padding its columns to the same width, and the ordinary wrap
   * collapses every run of spaces to one — which is the padding, and the
   * alignment with it.
   */
  pre?: boolean;
}

export function runFont(run: TextRun, segment?: TextSegment): string {
  const style = (segment?.italic ?? run.italic) === true ? "italic" : "normal";
  return `${style} ${weightOf(run, segment)} ${run.size}px ${run.family ?? SANS}`;
}

/** A segment's weight, the run's, or the browser default. */
function weightOf(run: TextRun, segment: TextSegment | undefined): number {
  if (segment?.weight !== undefined) return segment.weight;
  if (run.weight !== undefined) return run.weight;
  return 400;
}

/** A run and the pieces it is styled in, with `text` kept in step for the wrap. */
export function segmentedRun(run: Omit<TextRun, "text">, segments: TextSegment[]): TextRun {
  return { ...run, segments, text: segments.map((segment) => segment.text).join("") };
}

export function lineHeightOf(run: TextRun): number {
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
    // Preformatted: the line is the line. What runs past the column is cut
    // rather than wrapped, because a table row folded onto the next line stops
    // being a row.
    if (run.pre === true) {
      let kept = paragraph;
      while (kept.length > 1 && ctx.measureText(kept).width > maxWidth) kept = kept.slice(0, -1);
      lines.push(kept);
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

/** One drawn piece of a wrapped line: a stretch of text in one style. */
export interface LinePiece {
  text: string;
  segment?: TextSegment;
  /** Where the piece sits on its line, so what was drawn can be pointed at. */
  x: number;
  width: number;
}

/**
 * The same greedy wrap, over a run whose pieces are styled differently. Each word
 * is measured in its own piece's font, which is the whole reason this cannot go
 * through `wrapRun`: a line of bold words is wider than the same line of plain
 * ones, and wrapping it as plain text overflows the column.
 */
export function wrapSegments(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  maxWidth: number,
): LinePiece[][] {
  const lines: LinePiece[][] = [];
  let line: LinePiece[] = [];
  let lineWidth = 0;
  let pendingSpace = false;

  const widthOf = (text: string, segment: TextSegment): number => {
    ctx.font = runFont(run, segment);
    return ctx.measureText(text).width;
  };
  const breakLine = (): void => {
    lines.push(line);
    line = [];
    lineWidth = 0;
    pendingSpace = false;
  };
  const append = (text: string, segment: TextSegment, width: number): void => {
    const last = line[line.length - 1];
    if (last && last.segment === segment) {
      last.text += text;
      last.width += width;
    } else {
      line.push({ text, segment, x: lineWidth, width });
    }
    lineWidth += width;
  };

  for (const segment of run.segments ?? []) {
    for (const [index, part] of segment.text.split("\n").entries()) {
      if (index > 0) breakLine();

      for (const token of part.split(/(\s+)/)) {
        if (token.length === 0) continue;
        if (/^\s+$/.test(token)) {
          pendingSpace = line.length > 0;
          continue;
        }

        let word = token;
        let width = widthOf(word, segment);
        const space = pendingSpace ? widthOf(" ", segment) : 0;
        if (line.length > 0 && lineWidth + space + width > maxWidth) breakLine();
        else if (pendingSpace) append(" ", segment, space);
        pendingSpace = false;

        // A word wider than the column is cut rather than allowed to run off the
        // card, the same way the plain wrap cuts one.
        while (width > maxWidth && word.length > 1) {
          let cut = word.length - 1;
          while (cut > 1 && widthOf(word.slice(0, cut), segment) > maxWidth) cut -= 1;
          append(word.slice(0, cut), segment, maxWidth);
          breakLine();
          word = word.slice(cut);
          width = widthOf(word, segment);
        }
        append(word, segment, width);
      }
    }
  }
  if (line.length > 0) lines.push(line);

  const limit = run.maxLines;
  if (limit === undefined || lines.length <= limit) return lines;

  const kept = lines.slice(0, limit);
  const last = kept[limit - 1];
  const tail = last?.[last.length - 1];
  if (tail) tail.text = `${tail.text}…`;
  return kept;
}

export interface TextLayout {
  lines: { text: string; pieces: LinePiece[]; run: TextRun; y: number }[];
  height: number;
}

function measureIn(ctx: CanvasRenderingContext2D, run: TextRun, text: string): number {
  ctx.font = runFont(run);
  return ctx.measureText(text).width;
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
    y += run.gapBefore ?? 0;
    const wrapped = run.segments
      ? wrapSegments(ctx, run, width)
      : wrapRun(ctx, run, width).map((text): LinePiece[] => [
          { text, x: 0, width: measureIn(ctx, run, text) },
        ]);
    for (const pieces of wrapped) {
      lines.push({
        text: pieces.map((piece) => piece.text).join(""),
        pieces,
        run,
        y: y + run.size,
      });
      y += lineHeight;
    }
    y += run.gapAfter ?? 0;
  }
  return { lines, height: Math.ceil(y) };
}

/** Everything that changes what a bake looks like, including the palette in it. */
function runsKey(runs: readonly TextRun[]): string {
  return runs
    .map((run) =>
      [
        run.text,
        run.size,
        run.color,
        run.weight ?? "",
        String(run.italic ?? false),
        run.family ?? "",
        run.lineHeight ?? "",
        run.maxLines ?? "",
        run.gapAfter ?? "",
        run.gapBefore ?? "",
        (run.segments ?? [])
          .map((segment) =>
            [
              segment.text,
              segment.weight ?? "",
              String(segment.italic ?? false),
              String(segment.strike ?? false),
            ].join(","),
          )
          .join("|"),
      ].join(" "),
    )
    .join("");
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
 * The widest line the run wraps to, which is what something drawn around its own
 * text — a chat bubble — has to be sized from. A short message gets a short
 * bubble; only one that fills the column gets the whole of it.
 */
export function runWidth(run: TextRun, maxWidth: number): number {
  const ctx = measurer();
  ctx.font = runFont(run);

  let widest = 0;
  for (const line of wrapRun(ctx, run, maxWidth)) {
    widest = Math.max(widest, ctx.measureText(line).width);
  }
  return Math.ceil(widest);
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
  /** Where every piece landed, so a card can point at one of them. */
  layout: TextLayout;
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

    for (const piece of line.pieces) {
      ctx.font = runFont(line.run, piece.segment);
      ctx.fillStyle = piece.segment?.color ?? line.run.color;
      ctx.fillText(piece.text, piece.x, line.y);
      // A link says so by being underlined as well as coloured: colour alone is
      // the one thing a reader can be unable to see.
      const rule = Math.max(1, line.run.size / 14);
      if (piece.segment?.link !== undefined) {
        ctx.fillRect(piece.x, line.y + rule * 2, piece.width, rule);
      }
      if (piece.segment?.strike === true) {
        // Through the middle of the x-height rather than the em box: a rule at
        // the baseline reads as an underline.
        ctx.fillRect(piece.x, line.y - line.run.size * 0.3, piece.width, rule);
      }
    }
  }

  const texture = Texture.from(canvas);
  texture.source.resolution = resolution;
  return { texture, width, height, layout };
}

/**
 * Keyed by content and bake resolution, so a card that has not changed keeps its
 * texture across frames and a zoom step re-bakes only what is on screen.
 *
 * The runs are part of the key, not just the caller's `key`. Callers name a slot
 * — `sheet:body:<id>` — and a slot's text changes whenever the file behind it
 * does, so keying on the name alone hands back whatever that slot was baked with
 * the first time and the card never updates.
 */
export class TextTextureCache {
  private readonly entries = new Map<string, BakedText>();

  constructor(private readonly limit = 256) {}

  get(key: string, runs: TextRun[], width: number, resolution: number): BakedText {
    const cacheKey = `${key}|${runsKey(runs)}|${Math.round(width)}|${resolution}`;
    const hit = this.entries.get(cacheKey);
    if (hit) {
      // Re-inserted so the oldest key is the least recently used one.
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, hit);
      return hit;
    }

    const baked = bakeRuns(runs, width, resolution);
    this.entries.set(cacheKey, baked);
    // Evicted, not destroyed. A card keeps the texture it was handed until its
    // own content changes, so an entry can leave the cache while a sprite on
    // screen still draws it; destroying it there leaves that sprite bound to a
    // source that is gone, which the GL upload trips over. The GPU copy is
    // reclaimed by Pixi's texture GC once nothing draws it, and the canvas
    // behind it goes with the last sprite that held it.
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return baked;
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.texture.destroy(true);
    this.entries.clear();
  }
}
