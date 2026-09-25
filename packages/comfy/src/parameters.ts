/**
 * Filling a library workflow's parameters: the values a form or an agent gives,
 * checked against each parameter and written into a copy of the graph.
 */

import type {
  ComfyParameter,
  ComfyUpload,
  ComfyValidationIssue,
  ComfyWorkflow,
  ComfyWorkflowManifest,
} from "@nib-ui/ui-contracts";
import { parameterIssue } from "./manifest";

/** Seeds drawn for a run that did not name one; ComfyUI takes far larger, but these suffice. */
const RANDOM_SEED_RANGE = 2 ** 32;

export interface AppliedParameters {
  workflow: ComfyWorkflow;
  /** Image parameters, uploaded from the vault when the run is queued. */
  uploads: ComfyUpload[];
  issues: ComfyValidationIssue[];
}

/** A deep copy of an API workflow, so filling it leaves the library's untouched. */
export function cloneWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  return structuredClone(workflow);
}

/** The workflow with `values` written in, what has to be uploaded, and what was wrong. */
export function applyParameters(
  manifest: ComfyWorkflowManifest,
  values: Record<string, unknown>,
  random: () => number = Math.random,
): AppliedParameters {
  const workflow = cloneWorkflow(manifest.workflow);
  const uploads: ComfyUpload[] = [];
  const issues: ComfyValidationIssue[] = [];
  const known = new Set(manifest.parameters.map((parameter) => parameter.id));
  for (const id of Object.keys(values)) {
    if (!known.has(id)) issues.push(parameterIssue(`${manifest.name} has no parameter ${id}`));
  }
  for (const parameter of manifest.parameters) {
    const resolved = resolveValue(parameter, values[parameter.id], random);
    if (!resolved.ok) {
      issues.push(parameterIssue(`${parameter.label}: ${resolved.error}`));
      continue;
    }
    for (const target of parameter.targets) {
      const node = workflow[target.nodeId];
      if (!node) {
        issues.push(
          parameterIssue(`${parameter.label} targets node ${target.nodeId}, which is missing`),
        );
        continue;
      }
      node.inputs[target.input] = resolved.value;
      if (parameter.kind === "image" && typeof resolved.value === "string") {
        uploads.push({ nodeId: target.nodeId, input: target.input, path: resolved.value });
      }
    }
  }
  return { workflow, uploads, issues };
}

type Resolved = { ok: true; value: string | number | boolean } | { ok: false; error: string };

/** The value a parameter takes: the one given, else its default, else a random seed. */
function resolveValue(parameter: ComfyParameter, given: unknown, random: () => number): Resolved {
  let value = given;
  if (value === undefined || value === null || value === "") value = parameter.default;
  if (value === undefined && parameter.kind === "seed") {
    return { ok: true, value: Math.floor(random() * RANDOM_SEED_RANGE) };
  }
  if (value === undefined) return { ok: false, error: "a value is required" };
  return checkValue(parameter, value);
}

/** The value, converted where a form sends text for a number, or why it does not fit. */
export function checkValue(parameter: ComfyParameter, value: unknown): Resolved {
  if (parameter.kind === "image" || parameter.kind === "text") {
    if (typeof value !== "string") return { ok: false, error: "expected text" };
    return { ok: true, value };
  }
  if (parameter.kind === "boolean") {
    if (typeof value !== "boolean") return { ok: false, error: "expected true or false" };
    return { ok: true, value };
  }
  if (parameter.kind === "choice") return checkChoice(parameter, value);
  return checkNumber(parameter, value);
}

/** A choice has to be one of its options. */
function checkChoice(parameter: ComfyParameter, value: unknown): Resolved {
  if (typeof value !== "string") return { ok: false, error: "expected one of the options" };
  if (parameter.options && !parameter.options.includes(value)) {
    return { ok: false, error: `${value} is not one of ${parameter.options.join(", ")}` };
  }
  return { ok: true, value };
}

/** A number, whole for integers and seeds, within the parameter's range. */
function checkNumber(parameter: ComfyParameter, value: unknown): Resolved {
  let number = value;
  if (typeof number === "string" && number.trim() !== "") number = Number(number);
  if (typeof number !== "number" || !Number.isFinite(number)) {
    return { ok: false, error: "expected a number" };
  }
  if (parameter.kind !== "number" && !Number.isInteger(number)) {
    return { ok: false, error: "expected a whole number" };
  }
  if (parameter.min !== undefined && number < parameter.min) {
    return { ok: false, error: `below the minimum of ${parameter.min}` };
  }
  if (parameter.max !== undefined && number > parameter.max) {
    return { ok: false, error: `above the maximum of ${parameter.max}` };
  }
  return { ok: true, value: number };
}
