import type { Disposer } from "@nib-ui/kernel";
import type { CanvasObject, CanvasRegistry, ComfyRun, Rect } from "@nib-ui/ui-contracts";
import { PlaceholderLayer } from "./PlaceholderLayer";
import {
  awaitingResult,
  deliveredRuns,
  type PlaceholderScene,
  placeholdersFor,
  SWAP_GRACE_MS,
} from "./placeholders";

const LAYER_ID = "comfyui.placeholders";

/**
 * Registers the placeholder layer and keeps it in step with the runs and the
 * board on screen. An effect, so it redraws when a run or the board changes; a
 * timer covers the one change that is only time passing — a finished run's
 * grace running out.
 */
export function mountPlaceholders(
  canvas: CanvasRegistry,
  store: { readonly runs: ComfyRun[] },
): Disposer {
  const layer = new PlaceholderLayer();
  const unregister = canvas.registerLayer({ id: LAYER_ID, container: layer.container, order: 1 });
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  // Ticked by the grace timer so the effect runs again when time is the only
  // thing that changed; the scene itself reads the real time.
  let clock = $state(Date.now());
  // Not reactive: written by the effect that reads it, from what it just saw.
  let delivered = new Set<string>();

  /** The runs and the board as they stand now. */
  const scene = (): PlaceholderScene => ({
    runs: store.runs,
    cwd: canvas.cwd,
    boardDirectory: canvas.boardDirectory,
    shownIds: new Set(canvas.objects.map((object) => object.id)),
    cardBounds: cardBounds(canvas.objects),
    delivered,
    now: Math.max(clock, Date.now()),
  });

  const stopEffect = $effect.root(() => {
    $effect(() => {
      let current = scene();
      delivered = deliveredRuns(current);
      current = { ...current, delivered };
      layer.draw(placeholdersFor(current));
      if (graceTimer !== null || !awaitingResult(current)) return;
      graceTimer = setTimeout(() => {
        graceTimer = null;
        clock = Date.now();
      }, SWAP_GRACE_MS);
    });
  });

  return () => {
    stopEffect();
    if (graceTimer !== null) clearTimeout(graceTimer);
    unregister();
    layer.destroy();
  };
}

/** Where each placed card sits, by id; objects without a placement are left out. */
function cardBounds(objects: readonly CanvasObject[]): Map<string, Rect> {
  const bounds = new Map<string, Rect>();
  for (const object of objects) {
    const { x, y, w, h } = object;
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (typeof w !== "number" || typeof h !== "number") continue;
    bounds.set(object.id, { x, y, width: w, height: h });
  }
  return bounds;
}
