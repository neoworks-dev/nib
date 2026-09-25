/**
 * Which ComfyUI runs hold a spot on the board on screen, and what each one says.
 * A run's slot is chosen by the server when it is queued; the placeholder stands
 * there until the result card has taken its place.
 */

import type { ComfyResultSlot, ComfyRun } from "@nib-ui/ui-contracts";

/**
 * How long a finished run keeps its placeholder while the result card has not
 * arrived. The server places the output before it reports success, so the card
 * normally turns up within a scan; this only bounds a card that never does.
 */
export const SWAP_GRACE_MS = 10_000;

/** One placeholder to draw. */
export interface Placeholder {
  runId: string;
  slot: ComfyResultSlot;
  label: string;
  detail: string;
  /** From 0 to 1 while a node reports steps; null otherwise. */
  progress: number | null;
}

/** What decides which placeholders show: the runs, and the board they would be drawn on. */
export interface PlaceholderScene {
  runs: readonly ComfyRun[];
  cwd: string;
  boardDirectory: string;
  /** Ids of the cards on screen, which for a vault card is its path. */
  shownIds: ReadonlySet<string>;
  now: number;
}

/** The placeholders for runs on this board, oldest first so a newer one draws on top. */
export function placeholdersFor(scene: PlaceholderScene): Placeholder[] {
  const placeholders: Placeholder[] = [];
  for (const run of scene.runs) {
    const placeholder = placeholderFor(run, scene);
    if (placeholder) placeholders.push(placeholder);
  }
  return placeholders.reverse();
}

/** Whether any placeholder is only waiting for its result card, so the grace timer matters. */
export function awaitingResult(scene: PlaceholderScene): boolean {
  return scene.runs.some(
    (run) => run.status === "succeeded" && placeholderFor(run, scene) !== null,
  );
}

/** The placeholder for one run, or null when it has none on this board. */
function placeholderFor(run: ComfyRun, scene: PlaceholderScene): Placeholder | null {
  const { slot } = run;
  if (slot === null || run.cwd !== scene.cwd || slot.board !== scene.boardDirectory) return null;
  if (run.status === "failed" || run.status === "cancelled") return null;
  if (run.status === "succeeded" && !stillSwapping(run, scene)) return null;
  return {
    runId: run.id,
    slot,
    label: labelOf(run),
    detail: detailOf(run),
    progress: progressOf(run),
  };
}

/** A succeeded run whose result card is not on the board yet, within the grace period. */
function stillSwapping(run: ComfyRun, scene: PlaceholderScene): boolean {
  if (run.outputs.some((path) => scene.shownIds.has(path))) return false;
  if (run.finishedAt === null) return true;
  return scene.now - run.finishedAt < SWAP_GRACE_MS;
}

/** What the placeholder is titled. */
function labelOf(run: ComfyRun): string {
  if (run.label === null) return "ComfyUI";
  return run.label;
}

/** The line under the title: where the run has got to. */
function detailOf(run: ComfyRun): string {
  if (run.status === "queued") return "Queued";
  if (run.status === "succeeded") return "Placing the result…";
  const progress = progressOf(run);
  if (progress !== null) return `${Math.round(progress * 100)}%`;
  if (run.nodeType !== null) return run.nodeType;
  return "Running";
}

/** The executing node's steps as a fraction, when it reports them. */
function progressOf(run: ComfyRun): number | null {
  if (run.status !== "running" || run.progress === null || run.progress.max <= 0) return null;
  return Math.min(1, run.progress.value / run.progress.max);
}
