import type { DetectedRegion } from "@nib-ui/ui-contracts";

/**
 * Finding the elements in a screenshot when nothing will tell you what they are.
 *
 * The accessibility tree is authoritative where it exists, and for the applications this
 * feature is most interesting for — a 3D tool, a game, an Electron app started without
 * `--force-renderer-accessibility` — it does not. What is left is that a button, a field
 * and a panel are all high-contrast rectangles, which is something a page of array code can
 * find.
 *
 * Every stage is a pure function over typed arrays, so every stage is testable against a
 * bitmap drawn by hand. Not `@techstark/opencv-js`: nine megabytes of WebAssembly for
 * greyscale, Sobel, threshold, close and connected components.
 */

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, as `ImageData` and `createImageBitmap` produce. */
  data: Uint8ClampedArray;
}

export interface DetectorOptions {
  /**
   * Edge strength a pixel needs to count. Low enough to catch a flat button on a flat
   * panel, high enough to ignore the texture of a photograph.
   */
  threshold?: number;
  /** Regions smaller than this in either axis are noise — a glyph, an icon's corner. */
  minSize?: number;
  /** A region wider or taller than this fraction of the image is the window, not a control. */
  maxFraction?: number;
  /** Ceiling on how many are returned, largest confidence first. */
  limit?: number;
}

export const DETECTOR_DEFAULTS: Required<DetectorOptions> = {
  threshold: 48,
  minSize: 16,
  maxFraction: 0.9,
  limit: 120,
};

/** Rec. 601 luma. The eye's own weighting, and what every edge filter assumes it was given. */
export function greyscale(bitmap: Bitmap): Uint8ClampedArray {
  const { width, height, data } = bitmap;
  const grey = new Uint8ClampedArray(width * height);
  for (let index = 0; index < grey.length; index += 1) {
    const offset = index * 4;
    grey[index] = (data[offset]! * 299 + data[offset + 1]! * 587 + data[offset + 2]! * 114) / 1000;
  }
  return grey;
}

/**
 * Sobel gradient magnitude, approximated as `|gx| + |gy|` rather than the hypotenuse: the
 * result is thresholded immediately, and a square root per pixel over eight megapixels is
 * a cost paid for a number nothing reads.
 *
 * The one-pixel border is left at zero. There is no edge to find at the edge of a
 * screenshot, and it saves a bounds check per pixel in the inner loop.
 */
export function sobel(grey: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const edges = new Uint8ClampedArray(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const topLeft = grey[index - width - 1]!;
      const top = grey[index - width]!;
      const topRight = grey[index - width + 1]!;
      const left = grey[index - 1]!;
      const right = grey[index + 1]!;
      const bottomLeft = grey[index + width - 1]!;
      const bottom = grey[index + width]!;
      const bottomRight = grey[index + width + 1]!;

      const gx = topRight + 2 * right + bottomRight - topLeft - 2 * left - bottomLeft;
      const gy = bottomLeft + 2 * bottom + bottomRight - topLeft - 2 * top - topRight;
      edges[index] = Math.abs(gx) + Math.abs(gy);
    }
  }
  return edges;
}

export function threshold(edges: Uint8ClampedArray, cutoff: number): Uint8Array {
  const mask = new Uint8Array(edges.length);
  for (let index = 0; index < edges.length; index += 1)
    mask[index] = edges[index]! >= cutoff ? 1 : 0;
  return mask;
}

/**
 * Dilate then erode, separably: a horizontal pass then a vertical one, which is the same
 * result as a square kernel at a fraction of the work.
 *
 * This is what turns the four sides of a button into one connected component. Without it
 * every edge of every control is its own region and the component pass returns line
 * segments.
 */
export function close(mask: Uint8Array, width: number, height: number, radius = 2): Uint8Array {
  return erode(dilate(mask, width, height, radius), width, height, radius);
}

function sweep(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  wanted: 0 | 1,
): Uint8Array {
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let hit = false;
      for (let offset = -radius; offset <= radius && !hit; offset += 1) {
        const sample = x + offset;
        if (sample < 0 || sample >= width) continue;
        hit = mask[row + sample] === wanted;
      }
      horizontal[row + x] = hit ? wanted : ((1 - wanted) as 0 | 1);
    }
  }

  const vertical = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let hit = false;
      for (let offset = -radius; offset <= radius && !hit; offset += 1) {
        const sample = y + offset;
        if (sample < 0 || sample >= height) continue;
        hit = horizontal[sample * width + x] === wanted;
      }
      vertical[y * width + x] = hit ? wanted : ((1 - wanted) as 0 | 1);
    }
  }
  return vertical;
}

export function dilate(mask: Uint8Array, width: number, height: number, radius = 2): Uint8Array {
  return sweep(mask, width, height, radius, 1);
}

export function erode(mask: Uint8Array, width: number, height: number, radius = 2): Uint8Array {
  return sweep(mask, width, height, radius, 0);
}

export interface Component {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Set pixels inside the bounding box, for how solid the shape is. */
  area: number;
}

/**
 * Bounding boxes of the connected regions of set pixels, four-connected.
 *
 * The frontier is an explicit index stack rather than recursion: a screenshot-sized
 * component is hundreds of thousands of pixels, and a recursive flood fill overflows the
 * stack long before it finishes.
 */
export function components(mask: Uint8Array, width: number, height: number): Component[] {
  const seen = new Uint8Array(mask.length);
  const found: Component[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || seen[start] === 1) continue;

    seen[start] = 1;
    stack.push(start);
    let left = start % width;
    let right = left;
    let top = (start / width) | 0;
    let bottom = top;
    let area = 0;

    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index / width) | 0;
      area += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;

      if (x > 0 && mask[index - 1] === 1 && seen[index - 1] === 0) {
        seen[index - 1] = 1;
        stack.push(index - 1);
      }
      if (x < width - 1 && mask[index + 1] === 1 && seen[index + 1] === 0) {
        seen[index + 1] = 1;
        stack.push(index + 1);
      }
      if (y > 0 && mask[index - width] === 1 && seen[index - width] === 0) {
        seen[index - width] = 1;
        stack.push(index - width);
      }
      if (y < height - 1 && mask[index + width] === 1 && seen[index + width] === 0) {
        seen[index + width] = 1;
        stack.push(index + width);
      }
    }

    found.push({ x: left, y: top, width: right - left + 1, height: bottom - top + 1, area });
  }
  return found;
}

/**
 * How much a component is worth reporting. A control is a filled rectangle of a plausible
 * size; a stray outline is thin, and the whole window is enormous. Both fall out of the
 * ratio of set pixels to the bounding box.
 */
function score(component: Component): number {
  const box = component.width * component.height;
  if (box === 0) return 0;
  const fill = component.area / box;
  const aspect =
    Math.min(component.width, component.height) / Math.max(component.width, component.height);
  // A wide, well-filled shape is a button or a field; a hairline is a border.
  return Math.min(1, fill * 0.7 + aspect * 0.3);
}

/**
 * The whole pipeline. Pure: no canvas, no worker, no DOM — it takes pixels and returns
 * rectangles in the same pixel space, which is the space `DetectedRegion` is expressed in.
 */
export function detectRegions(bitmap: Bitmap, options: DetectorOptions = {}): DetectedRegion[] {
  const settings = { ...DETECTOR_DEFAULTS, ...options };
  const { width, height } = bitmap;
  if (width <= 2 || height <= 2) return [];

  const mask = close(
    threshold(sobel(greyscale(bitmap), width, height), settings.threshold),
    width,
    height,
  );
  const maxWidth = width * settings.maxFraction;
  const maxHeight = height * settings.maxFraction;

  return (
    components(mask, width, height)
      .filter(
        (component) =>
          component.width >= settings.minSize &&
          component.height >= settings.minSize &&
          component.width <= maxWidth &&
          component.height <= maxHeight,
      )
      .map((component, index) => ({
        id: `pixel-${index}`,
        rect: { x: component.x, y: component.y, width: component.width, height: component.height },
        source: "pixel" as const,
        confidence: score(component),
      }))
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, settings.limit)
      // Re-keyed after the sort so the ids read in the order they are returned.
      .map((region, index) => ({ ...region, id: `pixel-${index}` }))
  );
}
