/**
 * Reading `/object_info`. Every consumer — the validator, the converters, the
 * editor and the agent tools — asks the same questions of a node definition,
 * and this is the one place that knows how ComfyUI answers them.
 */

import type { ComfyNodeDefinitions } from "@nib-ui/ui-contracts";

/** The value types ComfyUI draws as widgets rather than as link slots. */
const WIDGET_TYPES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"]);

/** Inputs that get a "control after generate" widget even when the definition does not ask. */
const SEED_NAMES = new Set(["seed", "noise_seed"]);

/** One input of a node, in the order the node declares it. */
export interface InputSpec {
  name: string;
  /** `INT`, `COMBO`, `IMAGE`, or a comma-separated list of accepted link types. */
  type: string;
  required: boolean;
  /** A value typed into the node rather than a link from another. */
  widget: boolean;
  /** The values a combo accepts; null for anything else. */
  options: string[] | null;
  config: Record<string, unknown>;
}

/** One output slot of a node. */
export interface OutputSpec {
  name: string;
  type: string;
}

/** A definition's fields, read defensively: custom nodes report what they like. */
export interface NodeSpec {
  name: string;
  displayName: string;
  category: string;
  description: string;
  inputs: InputSpec[];
  outputs: OutputSpec[];
  outputNode: boolean;
}

/** The value as a plain object, or null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** The field as a string, or null. */
function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (typeof value === "string") return value;
  return null;
}

/** The array's string entries. */
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** The definition of one node class, or null when the server has none. */
export function nodeSpec(definitions: ComfyNodeDefinitions, nodeType: string): NodeSpec | null {
  const definition = asRecord(definitions[nodeType]);
  if (!definition) return null;
  let displayName = stringField(definition, "display_name");
  if (!displayName) displayName = nodeType;
  let category = stringField(definition, "category");
  if (category === null) category = "";
  let description = stringField(definition, "description");
  if (description === null) description = "";
  return {
    name: nodeType,
    displayName,
    category,
    description,
    inputs: inputSpecs(definition),
    outputs: outputSpecs(definition),
    outputNode: definition.output_node === true,
  };
}

/** Required inputs first, then optional ones, each in `input_order` when it is given. */
function inputSpecs(definition: Record<string, unknown>): InputSpec[] {
  const input = asRecord(definition.input);
  if (!input) return [];
  const order = asRecord(definition.input_order);
  return [
    ...sectionSpecs(asRecord(input.required), order?.required, true),
    ...sectionSpecs(asRecord(input.optional), order?.optional, false),
  ];
}

/** The inputs of one section (`required` or `optional`). */
function sectionSpecs(
  section: Record<string, unknown> | null,
  order: unknown,
  required: boolean,
): InputSpec[] {
  if (!section) return [];
  let names = strings(order);
  if (names.length === 0) names = Object.keys(section);
  const specs: InputSpec[] = [];
  for (const name of names) {
    const spec = inputSpec(name, section[name], required);
    if (spec) specs.push(spec);
  }
  return specs;
}

/** One input from its `[type, config]` pair. */
function inputSpec(name: string, raw: unknown, required: boolean): InputSpec | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  let config = asRecord(raw[1]);
  if (!config) config = {};
  const head: unknown = raw[0];
  if (Array.isArray(head)) {
    return { name, type: "COMBO", required, widget: true, options: strings(head), config };
  }
  if (typeof head !== "string") return null;
  let options: string[] | null = null;
  if (head === "COMBO") options = strings(config.options);
  // A socketless input of any type — a `COLOR` picker — takes a value, never a link.
  const takesValue = WIDGET_TYPES.has(head) || config.socketless === true;
  const widget = takesValue && config.forceInput !== true;
  return { name, type: head, required, widget, options, config };
}

/** Output slots, named by `output_name` where the node gives one. */
function outputSpecs(definition: Record<string, unknown>): OutputSpec[] {
  const types = strings(definition.output);
  const names = strings(definition.output_name);
  return types.map((type, index) => {
    let name = names[index];
    if (name === undefined) name = type;
    return { name, type };
  });
}

/**
 * Whether ComfyUI's frontend puts a "control after generate" widget after this
 * input. The widget has a saved value of its own, so the converters count it.
 */
export function hasControlWidget(input: InputSpec): boolean {
  if (input.type !== "INT" && input.type !== "FLOAT") return false;
  if (input.config.control_after_generate === true) return true;
  return input.type === "INT" && SEED_NAMES.has(input.name);
}

/** Whether the frontend adds an upload button after this combo, which also saves a value. */
export function hasUploadWidget(input: InputSpec): boolean {
  return (
    input.config.image_upload === true ||
    input.config.video_upload === true ||
    input.config.audio_upload === true
  );
}

/** Whether a link of `outputType` may feed an input declared as `inputType`. */
export function typesMatch(outputType: string, inputType: string): boolean {
  if (outputType === "*" || inputType === "*") return true;
  const accepted = inputType.split(",").map((type) => type.trim());
  const offered = outputType.split(",").map((type) => type.trim());
  return offered.some((type) => accepted.includes(type));
}

/** Every node class the server knows, as specs. */
export function allNodeSpecs(definitions: ComfyNodeDefinitions): NodeSpec[] {
  const specs: NodeSpec[] = [];
  for (const nodeType of Object.keys(definitions)) {
    const spec = nodeSpec(definitions, nodeType);
    if (spec) specs.push(spec);
  }
  return specs;
}
