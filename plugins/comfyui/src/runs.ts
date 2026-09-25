// How runs are listed and described. Pure, so the settings section and the
// tests read the same words.

import type { ComfyRun } from "@nib-ui/ui-contracts";

/** The list with one run added or replaced, newest first. */
export function upsertRun(runs: readonly ComfyRun[], run: ComfyRun): ComfyRun[] {
  const others = runs.filter((existing) => existing.id !== run.id);
  return [run, ...others].sort((left, right) => right.queuedAt - left.queuedAt);
}

/** Whether a run can still be cancelled. */
export function isActive(run: ComfyRun): boolean {
  return run.status === "queued" || run.status === "running";
}

/** What a run is doing, in one line: the node and its steps, or how it ended. */
export function describeRun(run: ComfyRun): string {
  if (run.status === "queued") return "Waiting in the ComfyUI queue";
  if (run.status === "cancelled") return "Cancelled";
  if (run.status === "failed") return failureText(run);
  if (run.status === "succeeded") return outputsText(run.outputs);
  return runningText(run);
}

/** The executing node and its step count, when it reports one. */
function runningText(run: ComfyRun): string {
  if (run.nodeId === null) return "Saving the outputs";
  let node = `node ${run.nodeId}`;
  if (run.nodeType !== null) node = `${run.nodeType} (${run.nodeId})`;
  if (run.progress === null || run.progress.max <= 1) return `Running ${node}`;
  return `Running ${node} · ${run.progress.value}/${run.progress.max}`;
}

/** The error, with the node it came from when ComfyUI named one. */
function failureText(run: ComfyRun): string {
  if (!run.error) return "Failed";
  if (run.error.nodeType !== null) return `${run.error.nodeType} failed: ${run.error.message}`;
  return `Failed: ${run.error.message}`;
}

/** Where the outputs went. */
function outputsText(outputs: readonly string[]): string {
  if (outputs.length === 0) return "Finished without saving a file";
  if (outputs.length === 1) return `Saved ${outputs[0]}`;
  return `Saved ${outputs.length} files, first ${outputs[0]}`;
}
