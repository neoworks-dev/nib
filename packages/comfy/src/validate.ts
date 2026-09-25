/**
 * Checks an API-format workflow against the server's node definitions without
 * queueing it, the way ComfyUI would, but saying precisely which node and input
 * is wrong and what was expected — so an agent can fix the graph and try again.
 */

import type {
  ComfyAvailability,
  ComfyNodeDefinitions,
  ComfyParameter,
  ComfyValidationIssue,
  ComfyWorkflow,
  ComfyWorkflowNode,
} from "@nib-ui/ui-contracts";
import { type InputSpec, type NodeSpec, nodeSpec, typesMatch } from "./definitions";

/** A combo value that looks like a file name is a model or asset that is not there. */
const FILE_NAME = /\.[a-z0-9]{2,12}$/i;

export interface ValidateOptions {
  /** `nodeId.input` keys whose values are filled in later, e.g. by an upload. */
  skipValues?: ReadonlySet<string>;
}

/** The key `skipValues` is addressed by. */
export function inputKey(nodeId: string, input: string): string {
  return `${nodeId}.${input}`;
}

/** Whether the value is a link: `[sourceNodeId, outputIndex]`. */
export function isLink(value: unknown): value is [string, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    (typeof value[0] === "string" || typeof value[0] === "number") &&
    typeof value[1] === "number"
  );
}

/** Every problem with the workflow; empty when ComfyUI should accept it. */
export function validateWorkflow(
  workflow: ComfyWorkflow,
  definitions: ComfyNodeDefinitions,
  options: ValidateOptions = {},
): ComfyValidationIssue[] {
  const issues: ComfyValidationIssue[] = [];
  let hasOutput = false;
  for (const [nodeId, node] of Object.entries(workflow)) {
    const spec = nodeSpec(definitions, node.class_type);
    if (!spec) {
      issues.push(issue("unknown_node", `${node.class_type} is not installed`, nodeId, node));
      continue;
    }
    if (spec.outputNode) hasOutput = true;
    issues.push(...nodeIssues(nodeId, node, spec, workflow, definitions, options));
  }
  if (!hasOutput && Object.keys(workflow).length > 0) {
    issues.push({
      code: "no_outputs",
      message: "the workflow has no output node (e.g. SaveImage), so nothing would run",
      nodeId: null,
      nodeType: null,
      input: null,
    });
  }
  return issues;
}

/** The problems with one node whose class the server knows. */
function nodeIssues(
  nodeId: string,
  node: ComfyWorkflowNode,
  spec: NodeSpec,
  workflow: ComfyWorkflow,
  definitions: ComfyNodeDefinitions,
  options: ValidateOptions,
): ComfyValidationIssue[] {
  const issues: ComfyValidationIssue[] = [];
  const declared = new Set(spec.inputs.map((input) => input.name));
  for (const input of spec.inputs) {
    const value = node.inputs[input.name];
    if (value === undefined) {
      if (input.required) {
        issues.push(issue("missing_input", `${input.name} is required`, nodeId, node, input));
      }
      continue;
    }
    if (isLink(value)) {
      issues.push(...linkIssues(nodeId, node, input, value, workflow, definitions));
      continue;
    }
    if (options.skipValues?.has(inputKey(nodeId, input.name))) continue;
    const valueIssue = literalIssue(nodeId, node, input, value);
    if (valueIssue) issues.push(valueIssue);
  }
  for (const name of Object.keys(node.inputs)) {
    // Dotted names are the sub-inputs of ComfyUI's dynamic widgets, which the definition nests.
    if (declared.has(name) || name.includes(".")) continue;
    issues.push({
      code: "unknown_input",
      message: `${node.class_type} has no input ${name}`,
      nodeId,
      nodeType: node.class_type,
      input: name,
    });
  }
  return issues;
}

/** What is wrong with a link into `input`, if anything. */
function linkIssues(
  nodeId: string,
  node: ComfyWorkflowNode,
  input: InputSpec,
  link: [string, number],
  workflow: ComfyWorkflow,
  definitions: ComfyNodeDefinitions,
): ComfyValidationIssue[] {
  const sourceId = String(link[0]);
  const source = workflow[sourceId];
  if (!source) {
    const message = `${input.name} is linked to node ${sourceId}, which does not exist`;
    return [issue("bad_link", message, nodeId, node, input)];
  }
  const sourceSpec = nodeSpec(definitions, source.class_type);
  // An unknown source is reported on its own node already.
  if (!sourceSpec) return [];
  const output = sourceSpec.outputs[link[1]];
  if (!output) {
    const message = `${input.name} is linked to output ${link[1]} of ${source.class_type} (${sourceId}), which has ${sourceSpec.outputs.length}`;
    return [issue("bad_link", message, nodeId, node, input)];
  }
  if (typesMatch(output.type, input.type)) return [];
  const message = `${input.name} takes ${input.type} but is linked to ${source.class_type} (${sourceId}) output ${link[1]}, which is ${output.type}`;
  return [{ ...issue("type_mismatch", message, nodeId, node, input), actual: output.type }];
}

/** What is wrong with a typed-in value, if anything. */
function literalIssue(
  nodeId: string,
  node: ComfyWorkflowNode,
  input: InputSpec,
  value: unknown,
): ComfyValidationIssue | null {
  if (!input.widget) {
    const message = `${input.name} takes a link from a ${input.type} output, not a value`;
    return issue("missing_input", message, nodeId, node, input);
  }
  if (input.type === "COMBO") return comboIssue(nodeId, node, input, value);
  if (input.type === "INT" || input.type === "FLOAT")
    return numberIssue(nodeId, node, input, value);
  if (input.type === "BOOLEAN" && typeof value !== "boolean") {
    return invalid(`${input.name} takes true or false`, nodeId, node, input, value);
  }
  if (input.type === "STRING" && typeof value !== "string") {
    return invalid(`${input.name} takes text`, nodeId, node, input, value);
  }
  return null;
}

/** A combo value must be one of its options; a missing file name is a missing model. */
function comboIssue(
  nodeId: string,
  node: ComfyWorkflowNode,
  input: InputSpec,
  value: unknown,
): ComfyValidationIssue | null {
  const options = input.options;
  if (!options) return null;
  if (typeof value === "string" && options.includes(value)) return null;
  const shown = options.slice(0, 12).join(", ");
  if (typeof value === "string" && FILE_NAME.test(value)) {
    const message = `${value} is not on the server for ${input.name}; available: ${shown || "none"}`;
    return { ...issue("missing_value", message, nodeId, node, input), actual: value };
  }
  return invalid(`${input.name} must be one of: ${shown}`, nodeId, node, input, value);
}

/** A number must be one, whole for `INT`, and within the declared range. */
function numberIssue(
  nodeId: string,
  node: ComfyWorkflowNode,
  input: InputSpec,
  value: unknown,
): ComfyValidationIssue | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return invalid(`${input.name} takes a number`, nodeId, node, input, value);
  }
  if (input.type === "INT" && !Number.isInteger(value)) {
    return invalid(`${input.name} takes a whole number`, nodeId, node, input, value);
  }
  const min = input.config.min;
  if (typeof min === "number" && value < min) {
    return invalid(`${input.name} is below its minimum of ${min}`, nodeId, node, input, value);
  }
  const max = input.config.max;
  if (typeof max === "number" && value > max) {
    return invalid(`${input.name} is above its maximum of ${max}`, nodeId, node, input, value);
  }
  return null;
}

/** An `invalid_value` issue that records what was given. */
function invalid(
  message: string,
  nodeId: string,
  node: ComfyWorkflowNode,
  input: InputSpec,
  value: unknown,
): ComfyValidationIssue {
  return { ...issue("invalid_value", message, nodeId, node, input), actual: JSON.stringify(value) };
}

/** An issue on a node, or on one of its inputs. */
function issue(
  code: ComfyValidationIssue["code"],
  message: string,
  nodeId: string,
  node: ComfyWorkflowNode,
  input?: InputSpec,
): ComfyValidationIssue {
  if (!input) return { code, message, nodeId, nodeType: node.class_type, input: null };
  return {
    code,
    message,
    nodeId,
    nodeType: node.class_type,
    input: input.name,
    expected: input.type,
  };
}

/**
 * What the server lacks to run a library workflow: node classes and model files.
 * Image parameters are left out, since their value is uploaded on every run.
 */
export function workflowAvailability(
  workflow: ComfyWorkflow,
  parameters: readonly ComfyParameter[],
  definitions: ComfyNodeDefinitions,
): ComfyAvailability {
  const skipValues = new Set<string>();
  for (const parameter of parameters) {
    if (parameter.kind !== "image") continue;
    for (const target of parameter.targets) skipValues.add(inputKey(target.nodeId, target.input));
  }
  const missingNodes = new Set<string>();
  const missingValues: ComfyAvailability["missingValues"] = [];
  for (const found of validateWorkflow(workflow, definitions, { skipValues })) {
    if (found.code === "unknown_node" && found.nodeType) missingNodes.add(found.nodeType);
    if (found.code !== "missing_value") continue;
    const { nodeId, nodeType, input, actual } = found;
    if (nodeId === null || nodeType === null || input === null || actual === undefined) continue;
    missingValues.push({ nodeId, nodeType, input, value: actual });
  }
  return {
    available: missingNodes.size === 0 && missingValues.length === 0,
    missingNodes: [...missingNodes].sort(),
    missingValues,
  };
}
