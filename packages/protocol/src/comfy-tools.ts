import { z } from "zod";

/**
 * The ComfyUI half of the agent tools, and the workflow manifest they exchange.
 * The manifest's schema lives here rather than beside the library because the
 * tools hand it to a model as JSON schema, and the library parses files with the
 * same definition — one shape, described once.
 */

/** Ids become file names, so they stay to the characters every file system takes. */
export const WORKFLOW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const comfyNodeSchema = z.object({
  class_type: z.string().min(1).describe("The node class, as comfy_search_nodes names it"),
  inputs: z
    .record(z.string(), z.unknown())
    .describe("Widget values by input name, or [sourceNodeId, outputIndex] to link an input"),
  _meta: z.object({ title: z.string().optional() }).optional(),
});

/** An API-format workflow: nodes keyed by id. */
export const workflowSchema = z
  .record(z.string(), comfyNodeSchema)
  .describe('ComfyUI API format: { "<nodeId>": { class_type, inputs } }');

export const parameterSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["image", "text", "number", "integer", "seed", "boolean", "choice"]),
  description: z.string().optional(),
  targets: z
    .array(z.object({ nodeId: z.string().min(1), input: z.string().min(1) }))
    .min(1)
    .describe("The node inputs the value is written into"),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.string()).optional(),
  multiline: z.boolean().optional(),
});

export const manifestSchema = z.object({
  id: z.string().regex(WORKFLOW_ID, "lowercase letters, digits and dashes"),
  name: z.string().min(1),
  description: z.string(),
  category: z.string().min(1).describe("e.g. image, 3d, texture"),
  parameters: z
    .array(parameterSchema)
    .describe(
      "The inputs a person fills in to run it; an image parameter takes a vault path and is uploaded",
    ),
  workflow: workflowSchema,
  graph: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("The editor's layout; leave it out and the editor lays the graph out itself"),
});

export const comfyToolNames = {
  searchNodes: "comfy_search_nodes",
  describeNodes: "comfy_describe_nodes",
  listModels: "comfy_list_models",
  listWorkflows: "comfy_list_workflows",
  readWorkflow: "comfy_read_workflow",
  validate: "comfy_validate_workflow",
  run: "comfy_run_workflow",
  readRun: "comfy_read_run",
  propose: "comfy_propose_workflow",
  save: "comfy_save_workflow",
} as const;

export type ComfyToolName = (typeof comfyToolNames)[keyof typeof comfyToolNames];

const workflowSourceSchema = z.enum(["bundled", "user", "project"]);

export const comfySearchNodesInputSchema = z.object({
  query: z.string().describe("Words to find in a node's name, category or description"),
  limit: z.number().int().min(1).max(100).optional().describe("At most this many; 25 by default"),
});

export const comfyDescribeNodesInputSchema = z.object({
  names: z.array(z.string()).min(1).max(20).describe("Node class names from comfy_search_nodes"),
});

export const comfyListModelsInputSchema = z.object({
  folder: z
    .string()
    .optional()
    .describe(
      "Only loader inputs whose name mentions this, e.g. lora or upscale; all when left out",
    ),
});

export const comfyListWorkflowsInputSchema = z.object({});

export const comfyReadWorkflowInputSchema = z.object({
  source: workflowSourceSchema,
  id: z.string(),
});

export const comfyValidateInputSchema = z.object({ workflow: workflowSchema });

export const comfyRunInputSchema = z.object({
  workflow: workflowSchema.optional().describe("A graph of your own, in API format"),
  library: z
    .object({
      source: workflowSourceSchema,
      id: z.string(),
      values: z.record(z.string(), z.unknown()).describe("Values by parameter id"),
    })
    .optional()
    .describe("A library workflow with its parameters filled, instead of a graph"),
  wait: z
    .boolean()
    .optional()
    .describe("Wait for the run to finish and return its outputs; true by default"),
});

export const comfyReadRunInputSchema = z.object({
  runId: z.string(),
  wait: z.boolean().optional().describe("Wait for the run to finish; false by default"),
});

export const comfyProposeInputSchema = z.object({ manifest: manifestSchema });

export const comfySaveInputSchema = z.object({
  manifest: manifestSchema,
  scope: z
    .enum(["project", "user"])
    .optional()
    .describe("The project's library (default) or the person's own, across projects"),
});

/**
 * What a harness is told about ComfyUI, so a request for a picture, a texture or
 * a model reaches for the library before a graph is written from nothing.
 */
export const comfyInstructions = [
  "# ComfyUI",
  "nib is connected to a local ComfyUI. To make or change images, textures or 3D models, use the " +
    "comfy_* tools. Start from the library: comfy_list_workflows, then comfy_run_workflow with a " +
    "library workflow and its parameter values. Only when nothing there fits, read the closest " +
    "workflow with comfy_read_workflow and adapt its graph rather than writing one from nothing; " +
    "find nodes with comfy_search_nodes and comfy_describe_nodes and models with comfy_list_models.",
  "Check a graph with comfy_validate_workflow and fix what it reports before running it. Outputs are " +
    "written into the vault under comfyui/, where they appear on the board. To offer a new workflow " +
    "for reuse, comfy_propose_workflow opens it in the node editor for the person to review and save; " +
    "comfy_save_workflow saves it straight away when you are asked to.",
].join("\n\n");
