import type { Disposer } from "@nib-ui/kernel";
import type { CanvasRegistry, ComfyRun } from "@nib-ui/ui-contracts";
import { PlaceholderLayer } from "./PlaceholderLayer";
import {
  awaitingResult,
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
  // Only the grace timer moves this. Between its ticks a finished run is judged
  // against an earlier time, which can only keep a placeholder a little longer.
  let clock = $state(Date.now());

  /** The runs and the board as they stand, at the clock's last tick. */
  const scene = (): PlaceholderScene => ({
    runs: store.runs,
    cwd: canvas.cwd,
    boardDirectory: canvas.boardDirectory,
    shownIds: new Set(canvas.objects.map((object) => object.id)),
    now: clock,
  });

  const stopEffect = $effect.root(() => {
    $effect(() => {
      const current = scene();
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
