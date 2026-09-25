/**
 * The node editor's document, apart from litegraph: what a file dropped or
 * opened turns into, how a widget becomes a library parameter, and the manifest
 * a save writes.
 */

import {
  asRecord,
  hasControlWidget,
  hasUploadWidget,
  type InputSpec,
  isPng,
  parseManifest,
  readPngWorkflow,
  WORKFLOW_ID,
  workflowSchema,
} from "@nib-ui/comfy";
import type {
  ComfyGraph,
  ComfyParameter,
  ComfyParameterKind,
  ComfyWorkflow,
  ComfyWorkflowManifest,
} from "@nib-ui/ui-contracts";

/** What an imported file held, in the most complete form it had. */
export type ImportedWorkflow =
  | { kind: "manifest"; manifest: ComfyWorkflowManifest }
  | { kind: "graph"; graph: ComfyGraph }
  | { kind: "workflow"; workflow: ComfyWorkflow }
  | { kind: "none"; reason: string };

/** The name, description and category a save writes; the graph supplies the rest. */
export interface ManifestDetails {
  id: string;
  name: string;
  description: string;
  category: string;
}

/**
 * Reads a file as a workflow: a library manifest, a UI graph exported from
 * ComfyUI, an API prompt, or a PNG ComfyUI wrote its workflow into.
 */
export function readImport(bytes: Uint8Array): ImportedWorkflow {
  if (isPng(bytes)) return readPng(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { kind: "none", reason: "the file is neither JSON nor a PNG" };
  }
  return readJson(parsed);
}

/** A PNG's embedded graph, else its prompt. */
function readPng(bytes: Uint8Array): ImportedWorkflow {
  const embedded = readPngWorkflow(bytes);
  if (embedded.graph) return { kind: "graph", graph: embedded.graph };
  if (embedded.workflow) return { kind: "workflow", workflow: embedded.workflow };
  return { kind: "none", reason: "the picture carries no ComfyUI workflow" };
}

/** A parsed JSON file as whichever of the three shapes it is. */
function readJson(parsed: unknown): ImportedWorkflow {
  const record = asRecord(parsed);
  if (!record) return { kind: "none", reason: "the file holds no workflow" };
  if ("parameters" in record && "workflow" in record) {
    const manifest = parseManifest(record);
    if (manifest.ok) return { kind: "manifest", manifest: manifest.manifest };
    return { kind: "none", reason: manifest.error };
  }
  if (Array.isArray(record.nodes)) return { kind: "graph", graph: record };
  const workflow = workflowSchema.safeParse(record);
  if (workflow.success && Object.keys(workflow.data).length > 0) {
    return { kind: "workflow", workflow: workflow.data };
  }
  return { kind: "none", reason: "the file holds no workflow" };
}

/**
 * An import as a manifest the editor can open: a manifest as it is, a bare
 * graph or prompt wrapped in one named after the file. A wrapped graph has an
 * empty `workflow` until the editor converts it.
 */
export function manifestFromImport(
  imported: Exclude<ImportedWorkflow, { kind: "none" }>,
  fileName: string,
): ComfyWorkflowManifest {
  if (imported.kind === "manifest") return imported.manifest;
  const name = fileName.replace(/\.[^.]+$/, "");
  const manifest: ComfyWorkflowManifest = {
    id: slugify(name),
    name,
    description: "",
    category: "image",
    parameters: [],
    workflow: {},
  };
  if (imported.kind === "graph") manifest.graph = imported.graph;
  if (imported.kind === "workflow") manifest.workflow = imported.workflow;
  return manifest;
}

/** How a widget of this input is filled in as a parameter; null for a link-only input. */
export function parameterKindFor(input: InputSpec): ComfyParameterKind | null {
  if (!input.widget) return null;
  if (input.type === "COMBO" && hasUploadWidget(input)) return "image";
  if (input.type === "COMBO") return "choice";
  if (input.type === "INT" && hasControlWidget(input)) return "seed";
  if (input.type === "INT") return "integer";
  if (input.type === "FLOAT") return "number";
  if (input.type === "BOOLEAN") return "boolean";
  if (input.type === "STRING") return "text";
  return null;
}

/** Whether a parameter already fills this node input. */
export function isExposed(
  parameters: readonly ComfyParameter[],
  nodeId: string,
  input: string,
): boolean {
  return parameters.some((parameter) =>
    parameter.targets.some((target) => target.nodeId === nodeId && target.input === input),
  );
}

/**
 * The parameters with one more: this node input, labelled after it, starting
 * from the value it has now. Its id is the input's name, numbered if taken.
 */
export function exposeInput(
  parameters: readonly ComfyParameter[],
  nodeId: string,
  input: InputSpec,
  currentValue: unknown,
): ComfyParameter[] {
  const kind = parameterKindFor(input);
  if (!kind || isExposed(parameters, nodeId, input.name)) return [...parameters];
  const parameter: ComfyParameter = {
    id: freeId(parameters, input.name),
    label: labelFor(input.name),
    kind,
    targets: [{ nodeId, input: input.name }],
  };
  const tooltip = input.config.tooltip;
  if (typeof tooltip === "string") parameter.description = tooltip;
  addLimits(parameter, input);
  addDefault(parameter, currentValue);
  return [...parameters, parameter];
}

/** The parameters without the one filling this node input. */
export function hideInput(
  parameters: readonly ComfyParameter[],
  nodeId: string,
  input: string,
): ComfyParameter[] {
  return parameters.filter(
    (parameter) =>
      !parameter.targets.some((target) => target.nodeId === nodeId && target.input === input),
  );
}

/** Carries over the input's range and options. */
function addLimits(parameter: ComfyParameter, input: InputSpec): void {
  const { min, max, step, multiline } = input.config;
  if (parameter.kind === "choice" && input.options) parameter.options = [...input.options];
  if (parameter.kind === "text" && multiline === true) parameter.multiline = true;
  if (parameter.kind !== "number" && parameter.kind !== "integer") return;
  if (typeof min === "number") parameter.min = min;
  if (typeof max === "number") parameter.max = max;
  if (typeof step === "number") parameter.step = step;
}

/** The value the widget has now becomes the default, except for pictures and seeds. */
function addDefault(parameter: ComfyParameter, value: unknown): void {
  if (parameter.kind === "image" || parameter.kind === "seed") return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    parameter.default = value;
  }
}

/** `base`, or `base-2`, `base-3`… when a parameter already has it. */
function freeId(parameters: readonly ComfyParameter[], base: string): string {
  const taken = new Set(parameters.map((parameter) => parameter.id));
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

/** `denoise_strength` → `Denoise strength`. */
function labelFor(name: string): string {
  const spaced = name.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A workflow id from its name: lowercase, dashes, within the id's limits. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (WORKFLOW_ID.test(slug)) return slug;
  return "workflow";
}

/**
 * The manifest a save writes. Parameters whose node is gone are dropped rather
 * than refused, since deleting a node in the editor is how they go away.
 */
export function buildManifest(
  details: ManifestDetails,
  parameters: readonly ComfyParameter[],
  workflow: ComfyWorkflow,
  graph: ComfyGraph,
): ComfyWorkflowManifest {
  const kept = parameters
    .map((parameter) => ({
      ...parameter,
      targets: parameter.targets.filter(
        (target) => target.input in (workflow[target.nodeId]?.inputs ?? {}),
      ),
    }))
    .filter((parameter) => parameter.targets.length > 0);
  return { ...details, parameters: kept, workflow, graph };
}
