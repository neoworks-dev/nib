/**
 * ComfyUI: a locally running server the app queues workflows on.
 *
 * The server side talks to ComfyUI; the browser only ever sees these shapes, and
 * the server shares them from here.
 */

import type { Disposer } from "@nib-ui/kernel";
import type { CanvasObject, Point } from "./canvas";

/** Where ComfyUI listens unless the user says otherwise. */
export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";

export const COMFY_LINEAGE_KIND = "comfy-lineage";

/**
 * A board object linking a picture a run was given to one it made from it, drawn
 * as a line between the two cards. Stored in the board document, so the link
 * outlives the run; it names the cards by vault path, which is a file card's id.
 */
export interface ComfyLineageObject extends CanvasObject {
  kind: typeof COMFY_LINEAGE_KIND;
  from: string;
  to: string;
}

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
  /** What is being run, shown while it runs; see `ComfyRun.label`. */
  label?: string;
  /**
   * Vault directory the outputs are written into. Left out, they go beside the
   * first upload, or into `comfyui` when there is none.
   */
  outputDirectory?: string;
  /**
   * Board point, in world units, the result's top-left corner goes to — where it
   * was asked for. Left out, it goes beside the first upload.
   */
  at?: Point;
}

export type ComfyRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ComfyRunError {
  message: string;
  nodeId: string | null;
  nodeType: string | null;
}

/**
 * Where a run's result will sit once it is in the vault, chosen when the run is
 * queued so the board can hold the spot while it runs.
 */
export interface ComfyResultSlot {
  /** The board directory the result lands on; `""` is the vault root. */
  board: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One queued workflow, from `POST /prompt` until its outputs are in the vault. */
export interface ComfyRun {
  /** ComfyUI's `prompt_id`. */
  id: string;
  cwd: string;
  /** What was run, e.g. the library workflow's name; null for a bare graph. */
  label: string | null;
  /** Vault paths of the pictures the run was given. */
  inputs: string[];
  /** Where the result will be placed; null when no board could be read. */
  slot: ComfyResultSlot | null;
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

/**
 * A graph in ComfyUI's UI format: what its editor saves and what a PNG carries
 * under `workflow`. Kept loose because the format has grown by accretion; the
 * converters in `@nib-ui/comfy` read it field by field.
 */
export type ComfyGraph = Record<string, unknown>;

/** How a parameter is filled in, which decides both its form field and its validation. */
export type ComfyParameterKind =
  "image" | "text" | "number" | "integer" | "seed" | "boolean" | "choice";

/** One node input a parameter writes into. */
export interface ComfyParameterTarget {
  nodeId: string;
  input: string;
}

/**
 * One meaningful input of a workflow, exposed so it can be run without touching
 * the graph. An `image` parameter takes a vault path and is uploaded on queue.
 */
export interface ComfyParameter {
  id: string;
  label: string;
  kind: ComfyParameterKind;
  description?: string;
  /** Usually one; a prompt fed to two encoders names both. */
  targets: ComfyParameterTarget[];
  /** Left out for a parameter that has to be given; a seed without one is random. */
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  /** The values a `choice` accepts. */
  options?: string[];
  /** A `text` parameter shown as a text area. */
  multiline?: boolean;
}

/**
 * A workflow as the library keeps it: one JSON file, the same shape whether it
 * is bundled, the user's, or a project's.
 */
export interface ComfyWorkflowManifest {
  /** Stable within its source; the file is named after it. */
  id: string;
  name: string;
  description: string;
  /** Groups the picker's list, e.g. `image`, `3d`. */
  category: string;
  parameters: ComfyParameter[];
  /** What `POST /prompt` is sent, before the parameters are written in. */
  workflow: ComfyWorkflow;
  /** The editor's layout, when the workflow was saved from it. */
  graph?: ComfyGraph;
}

/** Where a library workflow comes from; `project` lives in the vault, `user` beside the config. */
export type ComfyWorkflowSource = "bundled" | "user" | "project";

/** What stops a workflow from running on the connected ComfyUI. */
export interface ComfyAvailability {
  available: boolean;
  /** Node classes the server does not have: a custom node not installed. */
  missingNodes: string[];
  /** Values the server does not offer for an input: a model file not downloaded. */
  missingValues: { nodeId: string; nodeType: string; input: string; value: string }[];
}

/** A workflow in the library, with whether it can run right now. */
export interface ComfyLibraryEntry {
  source: ComfyWorkflowSource;
  manifest: ComfyWorkflowManifest;
  /** Null until ComfyUI has answered with its node definitions. */
  availability: ComfyAvailability | null;
}

/** Why a workflow or a parameter value is not valid, precise enough to act on. */
export interface ComfyValidationIssue {
  code:
    | "unknown_node"
    | "missing_input"
    | "unknown_input"
    | "bad_link"
    | "type_mismatch"
    | "invalid_value"
    | "missing_value"
    | "no_outputs"
    | "invalid_parameter";
  message: string;
  nodeId: string | null;
  nodeType: string | null;
  input: string | null;
  expected?: string;
  actual?: string;
}

/** Runs a library workflow with values for its parameters, keyed by parameter id. */
export interface ComfyRunWorkflowInput {
  cwd: string;
  source: ComfyWorkflowSource;
  workflowId: string;
  values: Record<string, unknown>;
  outputDirectory?: string;
  /** See `ComfyQueueInput.at`. */
  at?: Point;
}

/** Saves a workflow into the user's library or a project's. */
export interface ComfySaveWorkflowInput {
  source: "user" | "project";
  /** The project, for a `project` workflow. */
  cwd?: string;
  manifest: ComfyWorkflowManifest;
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
  /** Bundled, user and project workflows; the project's when `cwd` names one. */
  library(cwd: string | null): Promise<ComfyLibraryEntry[]>;
  /** Fills a library workflow's parameters and queues it. */
  runWorkflow(input: ComfyRunWorkflowInput): Promise<ComfyRun>;
  saveWorkflow(input: ComfySaveWorkflowInput): Promise<ComfyLibraryEntry>;
  deleteWorkflow(source: "user" | "project", id: string, cwd: string | null): Promise<void>;
  /**
   * Asks for a workflow to be shown in the editor; the node editor plugin
   * subscribes. Agents' drafts arrive this way too.
   */
  openInEditor(request: ComfyEditorRequest): void;
  subscribeEditorRequests(listener: (request: ComfyEditorRequest) => void): Disposer;
}

/** What the editor opens: a library workflow, a draft that has none yet, or nothing. */
export interface ComfyEditorRequest {
  source: ComfyWorkflowSource | "draft";
  manifest: ComfyWorkflowManifest | null;
  /** The project a draft or project workflow belongs to. */
  cwd: string | null;
}
