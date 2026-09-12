import type { WorkstreamStatus } from "./workstream";

/**
 * Every value the board is drawn from. The canvas cannot inherit the design
 * system's CSS variables the way every other surface does, so the surface
 * palette is stated here rather than read: the board is a light grey table
 * whatever the app's theme is, which is what makes a card on it read as paper.
 * Dark mode is a separate question and not answered here.
 *
 * Only the status accents still come from CSS, because they are semantic and
 * the badges elsewhere in the app have to agree with the ones drawn here.
 */
export interface BoardTheme {
  /** The table itself: flat light grey, no grid and no dots. */
  background: number;
  /** A sheet, a webclip, a folder: plain white paper. */
  card: number;
  /** A sticky, which is a shade warmer than the sheet beside it. */
  cardRaised: number;
  /** Hairline around a card, barely there — the shadow does the separating. */
  border: number;
  borderStrong: number;
  /** The selection ring, which is white rather than an accent colour. */
  action: number;
  text: string;
  muted: string;
  dim: string;
  faint: string;
  green: number;
  red: number;
  amber: number;
  blue: number;
  violet: number;
}

/**
 * One radius for every card on the board, fixed rather than proportional to the
 * card. A 250px image and a 600px sheet share a corner, which is what stops a
 * board of mixed sizes from reading as a collage.
 */
export const CARD_RADIUS = 12;

/** A webclip is a fixed-viewport capture, so its corners stay square. */
export const SHARP_RADIUS = 0;

/**
 * The drop shadow, in screen pixels. It is what lifts a card off the table, and
 * the raised variant is what a card being dragged, or sitting on top of a pile,
 * is drawn with.
 */
export const CARD_SHADOW = {
  offsetY: 2,
  blur: 12,
  alpha: 0.1,
  color: "#000000",
} as const;

export const CARD_SHADOW_RAISED = {
  offsetY: 8,
  blur: 24,
  alpha: 0.18,
  color: "#000000",
} as const;

/**
 * The selection chrome, in screen pixels: a crisp white ring sitting outside
 * the card's own edge, and thin grey bars at the four edge midpoints which are
 * the resize handles. Corners are not handles — Spatial only grew those in
 * v1.0.22, and the edge bars are what the frames show.
 */
export const SELECTION = {
  ringWidth: 3,
  ringOffset: 3,
  handleLength: 22,
  handleThickness: 3,
  handleColor: 0x9aa0a8,
  /** How far from a handle the pointer still counts as grabbing it. */
  handleReach: 9,
} as const;

/** A thin grey stroke over a faint white wash, with square corners. */
export const MARQUEE = {
  stroke: 0x9aa0a8,
  strokeWidth: 1,
  fill: 0xffffff,
  fillAlpha: 0.2,
} as const;

/** What the rest of the board fades to while one thing has the focus. */
export const DIMMED_ALPHA = 0.15;

/** Card padding and type sizes, in world units, shared by every text card. */
export const CARD_TYPE = {
  padding: 22,
  titleSize: 20,
  bodySize: 14,
  metaSize: 11,
  /** A sheet is a page, so its headline is the loudest thing on the board. */
  headlineSize: 26,
} as const;

const SURFACE = {
  background: 0xe9eaee,
  card: 0xffffff,
  cardRaised: 0xf4f5f7,
  border: 0xe2e4e8,
  borderStrong: 0xc9cdd4,
  action: 0xffffff,
  text: "#16171a",
  muted: "#5f6570",
  dim: "#8a8f98",
  faint: "#b4b8bf",
} as const;

export function readBoardTheme(root: HTMLElement = document.documentElement): BoardTheme {
  const styles = getComputedStyle(root);
  const readColor = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return cssColorToNumber(value.length > 0 ? value : fallback, fallback);
  };

  return {
    ...SURFACE,
    green: readColor("--ctx-green", "#4ade80"),
    red: readColor("--ctx-red", "#f87171"),
    amber: readColor("--ctx-amber", "#fbbf24"),
    blue: readColor("--ctx-blue", "#60a5fa"),
    violet: readColor("--ctx-violet", "#a78bfa"),
  };
}

let cached: BoardTheme | null = null;
let revision = 0;

/**
 * Read once and held. Renderers ask for the palette every frame, and
 * `getComputedStyle` forces a style recalculation — doing that per frame per
 * object is enough to stall the board on its own.
 */
export function boardTheme(): BoardTheme {
  cached ??= readBoardTheme();
  return cached;
}

/**
 * Bumped on every re-read. Colours are baked into the card textures, so a
 * renderer has to treat a theme switch as a change to everything it drew.
 */
export function themeRevision(): number {
  return revision;
}

/** Called when the document's theme attribute changes. */
export function refreshBoardTheme(): BoardTheme {
  cached = readBoardTheme();
  revision += 1;
  return cached;
}

let colorContext: CanvasRenderingContext2D | null = null;

/** Tokens may be any CSS colour, so the browser is what normalises them to hex. */
export function cssColorToNumber(color: string, fallback: string): number {
  const direct = parseHex(color);
  if (direct !== null) return direct;

  if (!colorContext) colorContext = document.createElement("canvas").getContext("2d");
  if (colorContext) {
    colorContext.fillStyle = "#000000";
    colorContext.fillStyle = color;
    const parsed = parseHex(colorContext.fillStyle);
    if (parsed !== null) return parsed;
  }
  return parseHex(fallback) ?? 0x000000;
}

function parseHex(color: string): number | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const digits = match[1]!;
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return Number.parseInt(full, 16);
}

/** The colour a workstream's state reads as, matching the status badges elsewhere. */
export function statusColor(status: WorkstreamStatus, theme: BoardTheme): number {
  switch (status) {
    case "working":
      return theme.blue;
    case "awaiting-permission":
      return theme.amber;
    case "error":
      return theme.red;
    case "closed":
      return theme.green;
    case "unlaunched":
      return theme.violet;
    default:
      return theme.borderStrong;
  }
}

export function statusWord(status: WorkstreamStatus): string {
  switch (status) {
    case "working":
      return "working";
    case "awaiting-permission":
      return "needs input";
    case "error":
      return "error";
    case "closed":
      return "completed";
    case "unlaunched":
      return "not started";
    case "detached":
      return "not loaded";
    default:
      return "idle";
  }
}
