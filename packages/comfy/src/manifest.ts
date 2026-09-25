/**
 * The library's file format. Bundled workflows are written by hand, user and
 * project ones by the editor or an agent, so every file is parsed before use.
 */

import type { ComfyValidationIssue, ComfyWorkflowManifest } from "@nib-ui/ui-contracts";
import { z } from "zod";

/** Ids become file names, so they stay to the characters every file system takes. */
export const WORKFLOW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const nodeSchema = z.object({
  class_type: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()),
  _meta: z.object({ title: z.string().optional() }).optional(),
});

/** An API-format workflow: nodes keyed by id. */
export const workflowSchema = z.record(z.string(), nodeSchema);

const parameterSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["image", "text", "number", "integer", "seed", "boolean", "choice"]),
  description: z.string().optional(),
  targets: z.array(z.object({ nodeId: z.string().min(1), input: z.string().min(1) })).min(1),
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
  category: z.string().min(1),
  parameters: z.array(parameterSchema),
  workflow: workflowSchema,
  graph: z.record(z.string(), z.unknown()).optional(),
});

export type ManifestParse =
  { ok: true; manifest: ComfyWorkflowManifest } | { ok: false; error: string };

/** The manifest in a file's parsed JSON, or what is wrong with it. */
export function parseManifest(value: unknown): ManifestParse {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const problems = manifestIssues(parsed.data);
  if (problems.length > 0) {
    return { ok: false, error: problems.map((problem) => problem.message).join("\n") };
  }
  return { ok: true, manifest: parsed.data };
}

/**
 * What is inconsistent between the parameters and the graph: a duplicate id, a
 * target node or input that is not there, a choice without options.
 */
export function manifestIssues(manifest: ComfyWorkflowManifest): ComfyValidationIssue[] {
  const issues: ComfyValidationIssue[] = [];
  const seen = new Set<string>();
  for (const parameter of manifest.parameters) {
    if (seen.has(parameter.id)) {
      issues.push(parameterIssue(`parameter ${parameter.id} is declared twice`));
    }
    seen.add(parameter.id);
    if (parameter.kind === "choice" && (!parameter.options || parameter.options.length === 0)) {
      issues.push(parameterIssue(`parameter ${parameter.id} is a choice without options`));
    }
    for (const target of parameter.targets) {
      const node = manifest.workflow[target.nodeId];
      if (!node) {
        issues.push(
          parameterIssue(
            `parameter ${parameter.id} targets node ${target.nodeId}, which is not in the workflow`,
          ),
        );
        continue;
      }
      if (!(target.input in node.inputs)) {
        issues.push(
          parameterIssue(
            `parameter ${parameter.id} targets ${node.class_type} (${target.nodeId}).${target.input}, which the node does not set`,
          ),
        );
      }
    }
  }
  return issues;
}

/** An `invalid_parameter` issue, which belongs to no single node. */
export function parameterIssue(message: string): ComfyValidationIssue {
  return { code: "invalid_parameter", message, nodeId: null, nodeType: null, input: null };
}
