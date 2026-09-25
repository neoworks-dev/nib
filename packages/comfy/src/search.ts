/**
 * Node definitions cut down for a model's context. The full `/object_info` runs
 * to megabytes; an agent searches it by word and reads the few nodes it picks.
 */

import type { ComfyNodeDefinitions } from "@nib-ui/ui-contracts";
import {
  allNodeSpecs,
  hasControlWidget,
  type InputSpec,
  type NodeSpec,
  nodeSpec,
} from "./definitions";

/** Combo options listed per input before the rest are summarised as a count. */
const LISTED_OPTIONS = 40;

export interface NodeSummary {
  name: string;
  displayName: string;
  category: string;
  description: string;
}

/** An input as an agent reads it. */
export interface InputDescription {
  name: string;
  type: string;
  required: boolean;
  /** A typed value rather than a link. */
  widget: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  options?: string[];
  /** How many options were left out of `options`. */
  moreOptions?: number;
  tooltip?: string;
}

export interface NodeDescription extends NodeSummary {
  inputs: InputDescription[];
  outputs: { index: number; name: string; type: string }[];
  outputNode: boolean;
}

/**
 * Node classes matching every word of the query in their name, display name,
 * category or description; names that match rank first.
 */
export function searchNodes(
  definitions: ComfyNodeDefinitions,
  query: string,
  limit: number,
): NodeSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { spec: NodeSpec; score: number }[] = [];
  for (const spec of allNodeSpecs(definitions)) {
    const score = matchScore(spec, words);
    if (score > 0) scored.push({ spec, score });
  }
  scored.sort(
    (left, right) => right.score - left.score || left.spec.name.localeCompare(right.spec.name),
  );
  return scored.slice(0, limit).map(({ spec }) => summary(spec));
}

/** 0 when a word is missing; higher the more words hit the name rather than the prose. */
function matchScore(spec: NodeSpec, words: string[]): number {
  const name = `${spec.name} ${spec.displayName}`.toLowerCase();
  const rest = `${spec.category} ${spec.description}`.toLowerCase();
  let score = 1;
  for (const word of words) {
    if (name.includes(word)) score += 3;
    else if (rest.includes(word)) score += 1;
    else return 0;
  }
  return score;
}

/** The fields a search result shows. */
function summary(spec: NodeSpec): NodeSummary {
  return {
    name: spec.name,
    displayName: spec.displayName,
    category: spec.category,
    description: spec.description,
  };
}

/** Full descriptions of the named nodes; names the server lacks are listed apart. */
export function describeNodes(
  definitions: ComfyNodeDefinitions,
  names: readonly string[],
): { nodes: NodeDescription[]; unknown: string[] } {
  const nodes: NodeDescription[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const spec = nodeSpec(definitions, name);
    if (spec) nodes.push(describe(spec));
    if (!spec) unknown.push(name);
  }
  return { nodes, unknown };
}

/** One node with its inputs and outputs, options trimmed. */
function describe(spec: NodeSpec): NodeDescription {
  return {
    ...summary(spec),
    inputs: spec.inputs.map(describeInput),
    outputs: spec.outputs.map((output, index) => ({ index, ...output })),
    outputNode: spec.outputNode,
  };
}

/** One input, keeping only the config an agent acts on. */
function describeInput(input: InputSpec): InputDescription {
  const description: InputDescription = {
    name: input.name,
    type: input.type,
    required: input.required,
    widget: input.widget,
  };
  const { config } = input;
  if (config.default !== undefined) description.default = config.default;
  if (typeof config.min === "number") description.min = config.min;
  if (typeof config.max === "number") description.max = config.max;
  if (typeof config.tooltip === "string") description.tooltip = config.tooltip;
  if (hasControlWidget(input) && description.default === undefined) description.default = 0;
  if (input.options) {
    description.options = input.options.slice(0, LISTED_OPTIONS);
    if (input.options.length > LISTED_OPTIONS) {
      description.moreOptions = input.options.length - LISTED_OPTIONS;
    }
  }
  return description;
}

/**
 * The model files the server offers, keyed by the loader input that takes them
 * (`CheckpointLoaderSimple.ckpt_name`): read off the loaders' combo inputs, the
 * same lists the validator checks against. `/object_info` does not name the
 * folders, and the loader input is what a graph has to fill anyway.
 */
export function installedModels(definitions: ComfyNodeDefinitions): Record<string, string[]> {
  const models: Record<string, string[]> = {};
  for (const spec of allNodeSpecs(definitions)) {
    if (!spec.category.includes("loaders")) continue;
    for (const input of spec.inputs) {
      if (!input.options || !input.name.endsWith("_name")) continue;
      models[`${spec.name}.${input.name}`] = [...input.options].sort();
    }
  }
  return models;
}
