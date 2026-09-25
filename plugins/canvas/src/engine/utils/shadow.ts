/**
 * The soft drop shadow under every card, baked once and stretched.
 *
 * A blur filter per card would cost a render pass per card, and a `Graphics`
 * rounded rect has no blur at all. Instead one rounded rect is drawn into a
 * canvas with `shadowBlur` and handed to a `NineSliceSprite`: the corners keep
 * their radius at any card size, the middle stretches, and the whole board pays
 * for two textures rather than one per object.
 */

import { NineSliceSprite, Texture } from "pixi.js";

export interface ShadowSpec {
  offsetY: number;
  blur: number;
  alpha: number;
  color: string;
}

/**
 * Padding baked around the rounded rect so the blur has room to fall off. The
 * sprite is drawn at `-margin` on both axes and `margin * 2` larger, which puts
 * the baked rect exactly over the card.
 */
function marginFor(spec: ShadowSpec): number {
  return Math.ceil(spec.blur * 1.5 + Math.abs(spec.offsetY) + 2);
}

function bake(radius: number, spec: ShadowSpec): { texture: Texture; margin: number } {
  const margin = marginFor(spec);
  // The slice has to cut inside the corner, so the baked rect is wide enough for
  // two corners plus a stretchable pixel between them.
  const side = margin * 2 + radius * 2 + 2;
  const resolution = globalThis.devicePixelRatio || 1;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(side * resolution);
  canvas.height = canvas.width;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context is unavailable");
  ctx.scale(resolution, resolution);

  ctx.shadowColor = spec.color;
  ctx.shadowBlur = spec.blur;
  ctx.shadowOffsetY = spec.offsetY;
  ctx.fillStyle = "#000000";
  ctx.globalAlpha = spec.alpha;
  ctx.beginPath();
  ctx.roundRect(margin, margin, side - margin * 2, side - margin * 2, radius);
  ctx.fill();

  const texture = Texture.from(canvas);
  texture.source.resolution = resolution;
  return { texture, margin };
}

/**
 * Holds the baked textures for the radii and specs actually in use. There are
 * two specs and one radius on the board today, so this stays at two entries.
 */
export class ShadowTextures {
  private readonly entries = new Map<string, { texture: Texture; margin: number }>();

  get(radius: number, spec: ShadowSpec): { texture: Texture; margin: number } {
    const key = `${radius}|${spec.offsetY}|${spec.blur}|${spec.alpha}|${spec.color}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = bake(radius, spec);
      this.entries.set(key, entry);
    }
    return entry;
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.texture.destroy(true);
    this.entries.clear();
  }
}

/** Shared: the textures depend on nothing a single card owns. */
export const shadowTextures = new ShadowTextures();

export function createShadowSprite(): NineSliceSprite {
  const sprite = new NineSliceSprite({ texture: Texture.EMPTY });
  sprite.eventMode = "none";
  return sprite;
}

/**
 * Sizes the sprite so the baked rect lands exactly over a card of `width` by
 * `height`, with the blur spilling outside it.
 */
export function applyShadow(
  sprite: NineSliceSprite,
  width: number,
  height: number,
  radius: number,
  spec: ShadowSpec,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): void {
  const { texture, margin } = shadowTextures.get(radius, spec);
  const slice = margin + radius;

  sprite.texture = texture;
  sprite.leftWidth = slice;
  sprite.rightWidth = slice;
  sprite.topHeight = slice;
  sprite.bottomHeight = slice;
  sprite.position.set(origin.x - margin, origin.y - margin);
  sprite.setSize(width + margin * 2, height + margin * 2);
}
