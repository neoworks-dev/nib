/**
 * A workflow's parameters as pills in the composer's row: what each pill says,
 * and which choices its menu offers. Kept out of the components so the wording
 * and the presets can be tested.
 */

import type { ComfyParameter } from "@nib-ui/ui-contracts";

type Value = string | number | boolean | undefined;

/** A range this small reads better as buttons than as a slider. */
const MAX_INTEGER_CHOICES = 8;

/** Pixel sizes snap to this, the multiple diffusion models work in. */
const SIZE_GRID = 64;

/** Width and height when a workflow has both, shown as one size pill. */
export interface SizePair {
  width: ComfyParameter;
  height: ComfyParameter;
}

/** One pick in the size pill's menu. */
export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

/** What a pill shows: the parameter's name and its value, or how it stands without one. */
export function parameterPillLabel(parameter: ComfyParameter, value: Value): string {
  if (parameter.kind === "seed") return seedLabel(value);
  if (parameter.kind === "boolean") return parameter.label;
  if (parameter.kind === "image") return imageLabel(parameter, value);
  if (value === undefined || value === "") return parameter.label;
  if (parameter.kind === "text") return textLabel(parameter, String(value));
  return `${parameter.label} ${String(value)}`;
}

/** Longest text a pill quotes before it cuts it short. */
const MAX_QUOTED_TEXT = 16;

/**
 * Text is the longest thing a pill could show, so a list counts its terms and
 * anything else is cut short; the menu has the whole of it.
 */
function textLabel(parameter: ComfyParameter, text: string): string {
  const terms = text
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  if (terms.length > 1) return `${parameter.label} · ${terms.length} terms`;
  if (text.length <= MAX_QUOTED_TEXT) return `${parameter.label}: ${text}`;
  return `${parameter.label}: ${text.slice(0, MAX_QUOTED_TEXT).trimEnd()}…`;
}

/** A seed left empty draws a new one on every run. */
function seedLabel(value: Value): string {
  if (value === undefined || value === "") return "Random seed";
  return `Seed ${String(value)}`;
}

/** A picture by its file name; the folder it sits in is in the menu. */
function imageLabel(parameter: ComfyParameter, value: Value): string {
  if (typeof value !== "string" || value.length === 0) return parameter.label;
  const name = value.split("/").at(-1);
  if (name === undefined) return value;
  return name;
}

/** Every value of an integer parameter whose whole range fits in a row of buttons; null otherwise. */
export function integerChoices(parameter: ComfyParameter): number[] | null {
  if (parameter.kind !== "integer") return null;
  const { min, max } = parameter;
  if (min === undefined || max === undefined) return null;
  const step = parameter.step ?? 1;
  const count = Math.floor((max - min) / step) + 1;
  if (count > MAX_INTEGER_CHOICES) return null;
  return Array.from({ length: count }, (_, index) => min + index * step);
}

/** The workflow's width and height, when it has both as integers. */
export function sizePair(parameters: readonly ComfyParameter[]): SizePair | null {
  const width = parameters.find((parameter) => parameter.id === "width");
  const height = parameters.find((parameter) => parameter.id === "height");
  if (!width || !height) return null;
  if (width.kind !== "integer" || height.kind !== "integer") return null;
  return { width, height };
}

/** The size pill's text. */
export function sizeLabel(width: Value, height: Value): string {
  return `${String(width ?? "?")} × ${String(height ?? "?")}`;
}

/**
 * Square, portrait and landscape around the workflow's default size, kept on the
 * model's grid and inside the range both parameters allow.
 */
export function sizePresets(pair: SizePair): SizePreset[] {
  const base = numberOr(pair.width.default, 1024);
  const short = snapToGrid((base * 3) / 4);
  const presets = [
    { label: "Square", width: base, height: base },
    { label: "Portrait", width: short, height: base },
    { label: "Landscape", width: base, height: short },
  ];
  return presets.map((preset) => ({
    label: preset.label,
    width: clamp(preset.width, pair.width),
    height: clamp(preset.height, pair.height),
  }));
}

/** The value when it is a number, else the fallback. */
function numberOr(value: unknown, fallback: number): number {
  if (typeof value === "number") return value;
  return fallback;
}

function snapToGrid(value: number): number {
  return Math.round(value / SIZE_GRID) * SIZE_GRID;
}

/** Keeps a value inside the parameter's range. */
function clamp(value: number, parameter: ComfyParameter): number {
  let clamped = value;
  if (parameter.min !== undefined) clamped = Math.max(parameter.min, clamped);
  if (parameter.max !== undefined) clamped = Math.min(parameter.max, clamped);
  return clamped;
}

/** The range a number takes, in words, for the pill's menu; null without both ends. */
export function rangeHint(parameter: ComfyParameter): string | null {
  if (parameter.min === undefined || parameter.max === undefined) return null;
  return `From ${parameter.min} to ${parameter.max}`;
}
