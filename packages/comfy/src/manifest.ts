/**
 * The library's file format. Bundled workflows are written by hand, user and
 * project ones by the editor or an agent, so every file is parsed before use.
 */

import { manifestSchema } from "@nib-ui/protocol";
import type { ComfyValidationIssue, ComfyWorkflowManifest } from "@nib-ui/ui-contracts";
import { z } from "zod";

// The schemas are the agent tools' as much as the library's, so they live with the tools.
export { manifestSchema, WORKFLOW_ID, workflowSchema } from "@nib-ui/protocol";

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
