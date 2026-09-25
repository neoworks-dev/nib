// What a run looks like after each socket event. Pure, so the order ComfyUI
// sends things in can be replayed in a test.

import type { ComfyRun, ComfyWorkflow } from "@nib-ui/ui-contracts";
import type { ComfyEvent } from "./comfyui";

/** A run ComfyUI has just accepted. */
export function queuedRun(id: string, cwd: string, now: number): ComfyRun {
  return {
    id,
    cwd,
    status: "queued",
    queuedAt: now,
    finishedAt: null,
    nodeId: null,
    nodeType: null,
    progress: null,
    outputs: [],
    error: null,
  };
}

/** Whether a run has stopped changing. */
export function isFinished(run: ComfyRun): boolean {
  return run.status === "succeeded" || run.status === "failed" || run.status === "cancelled";
}

/**
 * The run after one event. `execution_success` leaves it running: it has
 * succeeded once its outputs are in the vault, which `succeedRun` records.
 */
export function applyEvent(
  run: ComfyRun,
  event: ComfyEvent,
  workflow: ComfyWorkflow,
  now: number,
): ComfyRun {
  if (isFinished(run)) return run;
  if (event.type === "execution_start") return { ...run, status: "running" };
  if (event.type === "executing") return atNode(run, event.nodeId, workflow);
  // The files an output node saved are collected by whoever delivers the run.
  if (event.type === "executed") return run;
  if (event.type === "progress") {
    const moved = atNode(run, event.nodeId, workflow);
    return { ...moved, progress: { value: event.value, max: event.max } };
  }
  if (event.type === "execution_success") return atNode(run, null, workflow);
  if (event.type === "execution_interrupted") {
    return { ...atNode(run, null, workflow), status: "cancelled", finishedAt: now };
  }
  const error = { message: event.message, nodeId: event.nodeId, nodeType: event.nodeType };
  return { ...atNode(run, null, workflow), status: "failed", finishedAt: now, error };
}

/**
 * The run with another node executing. A node that did not send the event keeps
 * the current one: `progress` comes without a node from some custom nodes.
 */
function atNode(run: ComfyRun, nodeId: string | null, workflow: ComfyWorkflow): ComfyRun {
  if (nodeId === null)
    return { ...run, status: "running", nodeId: null, nodeType: null, progress: null };
  if (nodeId === run.nodeId) return { ...run, status: "running" };
  let nodeType: string | null = null;
  const node = workflow[nodeId];
  if (node) nodeType = node.class_type;
  return { ...run, status: "running", nodeId, nodeType, progress: null };
}

/** The run once its outputs are in the vault. */
export function succeedRun(run: ComfyRun, outputs: string[], now: number): ComfyRun {
  return { ...run, status: "succeeded", finishedAt: now, outputs, nodeId: null, nodeType: null };
}

/** The run failed outside ComfyUI's own events: the outputs could not be fetched or written. */
export function failRun(run: ComfyRun, message: string, now: number): ComfyRun {
  return {
    ...run,
    status: "failed",
    finishedAt: now,
    nodeId: null,
    nodeType: null,
    progress: null,
    error: { message, nodeId: null, nodeType: null },
  };
}

/** The run dropped from the queue before it started. */
export function cancelRun(run: ComfyRun, now: number): ComfyRun {
  return {
    ...run,
    status: "cancelled",
    finishedAt: now,
    nodeId: null,
    nodeType: null,
    progress: null,
  };
}
