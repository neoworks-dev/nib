export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function easeInCubic(t: number): number {
  return t * t * t;
}

/**
 * The swoosh: almost all of the distance is covered in the first third and the
 * rest is a glide into place. What a card coming out of a folder does — it is
 * pulled out, and then it settles.
 */
export function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - 2 ** (-10 * t);
}
