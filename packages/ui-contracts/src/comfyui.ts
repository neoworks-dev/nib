/**
 * ComfyUI: a locally running server the app queues workflows on.
 *
 * The server side talks to ComfyUI; the browser only ever sees these shapes, and
 * the server shares them from here.
 */

import type { Disposer } from "@nib-ui/kernel";

/** Where ComfyUI listens unless the user says otherwise. */
export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";

/** One node of an API-format workflow: what `POST /prompt` takes. */
export interface ComfyWorkflowNode {
  class_type: string;
  /** Widget values, or `[sourceNodeId, outputIndex]` for a link. */
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

/** An API-format workflow, keyed by node id. */
export type ComfyWorkflow = Record<string, ComfyWorkflowNode>;

/**
 * `/object_info` as ComfyUI reports it. Kept loose on purpose: custom nodes put
 * whatever they like in there, and the editor and the validator read it field by field.
 */
export type ComfyNodeDefinitions = Record<string, Record<string, unknown>>;

export interface ComfyStatus {
  baseUrl: string;
  connected: boolean;
  /** ComfyUI's own version, once it has answered. */
  version: string | null;
  /** Why the server could not be reached, when it could not. */
  error: string | null;
}

/** A vault file handed to a workflow node as its input, uploaded when the run is queued. */
export interface ComfyUpload {
  nodeId: string;
  /** The node input the uploaded name is written into, usually `image`. */
  input: string;
  /** Vault-relative path of the file. */
  path: string;
}

export interface ComfyQueueInput {
  /** The project whose vault receives the outputs and holds the uploads. */
  cwd: string;
  workflow: ComfyWorkflow;
  uploads?: ComfyUpload[];
  /** Vault directory the outputs are written into; `comfyui` when left out. */
  outputDirectory?: string;
}

export type ComfyRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ComfyRunError {
  message: string;
  nodeId: string | null;
  nodeType: string | null;
}

/** One queued workflow, from `POST /prompt` until its outputs are in the vault. */
export interface ComfyRun {
  /** ComfyUI's `prompt_id`. */
  id: string;
  cwd: string;
  status: ComfyRunStatus;
  queuedAt: number;
  finishedAt: number | null;
  /** The node executing right now; null before the run starts and after it ends. */
  nodeId: string | null;
  nodeType: string | null;
  /** Steps of the executing node, for the nodes that report them (samplers, mostly). */
  progress: { value: number; max: number } | null;
  /** Vault paths the outputs were written to. */
  outputs: string[];
  error: ComfyRunError | null;
}

/** The app's side of ComfyUI, provided by the `comfyui` plugin. */
export interface ComfyService {
  /** Reactive: the last status the server reported, null before the first check. */
  readonly status: ComfyStatus | null;
  /** Reactive: every run the server knows about, newest first. */
  readonly runs: readonly ComfyRun[];
  /** Asks the server again whether ComfyUI is reachable. */
  refreshStatus(): Promise<ComfyStatus>;
  /** Points the app at another ComfyUI and reports whether it answers there. */
  configure(baseUrl: string): Promise<ComfyStatus>;
  /** Node definitions, cached on the server until `refresh` asks for them again. */
  nodeDefinitions(options?: { refresh?: boolean }): Promise<ComfyNodeDefinitions>;
  queue(input: ComfyQueueInput): Promise<ComfyRun>;
  cancel(runId: string): Promise<void>;
  /** Called with a run every time it changes. */
  subscribe(listener: (run: ComfyRun) => void): Disposer;
}
