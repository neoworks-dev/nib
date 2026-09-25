/**
 * ComfyUI keeps a workflow in two shapes. The UI format (litegraph's JSON) is a
 * drawing: positioned nodes, numbered links, widget values in a list. The API
 * format is what runs: nodes keyed by id with named inputs. The editor works in
 * the first and queues the second; the library stores the second and draws it
 * with the first. Both directions are pure and read the node definitions for
 * the one thing neither shape says on its own: which widget a listed value is.
 */

import type {
  ComfyGraph,
  ComfyNodeDefinitions,
  ComfyWorkflow,
  ComfyWorkflowNode,
} from "@nib-ui/ui-contracts";
import {
  asRecord,
  hasControlWidget,
  hasUploadWidget,
  type InputSpec,
  type NodeSpec,
  nodeSpec,
} from "./definitions";
import { isLink } from "./validate";

/** Litegraph node modes that keep a node out of the prompt. */
const MODE_NEVER = 2;
const MODE_BYPASS = 4;

/** Node types that exist only in the frontend and never reach the server. */
const FRONTEND_ONLY = new Set(["Note", "MarkdownNote", "Reroute", "PrimitiveNode"]);

/** What the frontend stores for a "control after generate" widget left alone. */
const CONTROL_DEFAULT = "fixed";
/** What the frontend stores for an upload button. */
const UPLOAD_DEFAULT = "image";

/** Node geometry for graphs laid out here. */
const COLUMN_WIDTH = 380;
const NODE_WIDTH = 320;
const NODE_GAP = 40;
const TITLE_HEIGHT = 30;
const ROW_HEIGHT = 24;

export interface UiInputSlot {
  name: string;
  type: string;
  link: number | null;
  /** Present when the slot is a widget taking a link instead of a typed value. */
  widget?: { name: string };
}

export interface UiOutputSlot {
  name: string;
  type: string;
  links: number[] | null;
  slot_index?: number;
  widget?: { name: string };
}

export interface UiNode {
  id: number;
  type: string;
  title?: string;
  pos: [number, number];
  size: [number, number];
  flags: Record<string, unknown>;
  order: number;
  mode: number;
  inputs: UiInputSlot[];
  outputs: UiOutputSlot[];
  properties: Record<string, unknown>;
  widgets_values: unknown[] | Record<string, unknown>;
}

/** A link as the UI format stores it: `[id, originId, originSlot, targetId, targetSlot, type]`. */
export type UiLink = [number, number, number, number, number, string];

/** A UI-format graph, the version this module writes. */
export interface UiGraph extends ComfyGraph {
  last_node_id: number;
  last_link_id: number;
  nodes: UiNode[];
  links: UiLink[];
  groups: unknown[];
  config: Record<string, unknown>;
  extra: Record<string, unknown>;
  version: number;
}

/** A link resolved to its ends. */
interface LinkEnds {
  originId: number;
  originSlot: number;
  targetId: number;
  targetSlot: number;
  type: string;
}

export interface ConversionResult {
  workflow: ComfyWorkflow;
  /** What could not be carried over, for the user to see; the workflow is still usable. */
  warnings: string[];
}

/** Thrown for a graph this module cannot read at all. */
export class GraphFormatError extends Error {}

/** The graph's nodes and links, read from either the 0.4 or the 1.0 layout. */
function readGraph(graph: ComfyGraph): {
  nodes: Map<number, UiNode>;
  links: Map<number, LinkEnds>;
} {
  const definitions = asRecord(graph.definitions);
  if (definitions && Array.isArray(definitions.subgraphs) && definitions.subgraphs.length > 0) {
    throw new GraphFormatError(
      "workflows with subgraphs are not supported yet; unpack them in ComfyUI first",
    );
  }
  if (!Array.isArray(graph.nodes)) throw new GraphFormatError("the graph has no nodes list");
  const nodes = new Map<number, UiNode>();
  for (const raw of graph.nodes) {
    const node = readNode(raw);
    if (node) nodes.set(node.id, node);
  }
  const links = new Map<number, LinkEnds>();
  if (Array.isArray(graph.links)) {
    for (const raw of graph.links) {
      const link = readLink(raw);
      if (link) links.set(link.id, link.ends);
    }
  }
  return { nodes, links };
}

/** One node, with the fields this module relies on made sure of. */
function readNode(raw: unknown): UiNode | null {
  const record = asRecord(raw);
  if (!record || typeof record.type !== "string") return null;
  const id = Number(record.id);
  if (!Number.isFinite(id)) return null;
  let mode = 0;
  if (typeof record.mode === "number") mode = record.mode;
  let widgetsValues: UiNode["widgets_values"] = [];
  if (Array.isArray(record.widgets_values)) widgetsValues = record.widgets_values;
  const valuesByName = asRecord(record.widgets_values);
  if (valuesByName) widgetsValues = valuesByName;
  let title: string | undefined;
  if (typeof record.title === "string") title = record.title;
  return {
    id,
    type: record.type,
    title,
    pos: pair(record.pos, [0, 0]),
    size: pair(record.size, [NODE_WIDTH, 100]),
    flags: asRecord(record.flags) ?? {},
    order: typeof record.order === "number" ? record.order : 0,
    mode,
    inputs: readSlots(record.inputs).map(inputSlot),
    outputs: readSlots(record.outputs).map(outputSlot),
    properties: asRecord(record.properties) ?? {},
    widgets_values: widgetsValues,
  };
}

/** A position or size, which litegraph saves as a pair or as `{0: x, 1: y}`. */
function pair(value: unknown, fallback: [number, number]): [number, number] {
  if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number") {
    return [value[0], value[1]];
  }
  const record = asRecord(value);
  if (record && typeof record[0] === "number" && typeof record[1] === "number") {
    return [record[0], record[1]];
  }
  return fallback;
}

/** The slot records of a node's `inputs` or `outputs`. */
function readSlots(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const slots: Record<string, unknown>[] = [];
  for (const entry of value) {
    const slot = asRecord(entry);
    if (slot) slots.push(slot);
  }
  return slots;
}

/** The widget a slot stands for, if it is one. */
function slotWidget(slot: Record<string, unknown>): { name: string } | undefined {
  const widget = asRecord(slot.widget);
  if (widget && typeof widget.name === "string") return { name: widget.name };
  return undefined;
}

/** An input slot from its saved record. */
function inputSlot(slot: Record<string, unknown>): UiInputSlot {
  let link: number | null = null;
  if (typeof slot.link === "number") link = slot.link;
  const input: UiInputSlot = { name: String(slot.name), type: String(slot.type), link };
  const widget = slotWidget(slot);
  if (widget) input.widget = widget;
  return input;
}

/** An output slot from its saved record. */
function outputSlot(slot: Record<string, unknown>): UiOutputSlot {
  let links: number[] | null = null;
  if (Array.isArray(slot.links)) links = slot.links.filter((link) => typeof link === "number");
  const output: UiOutputSlot = { name: String(slot.name), type: String(slot.type), links };
  const widget = slotWidget(slot);
  if (widget) output.widget = widget;
  return output;
}

/** One link, from an array (0.4) or an object (1.0). */
function readLink(raw: unknown): { id: number; ends: LinkEnds } | null {
  if (Array.isArray(raw) && raw.length >= 5) {
    const [id, originId, originSlot, targetId, targetSlot, type] = raw;
    return {
      id: Number(id),
      ends: {
        originId: Number(originId),
        originSlot: Number(originSlot),
        targetId: Number(targetId),
        targetSlot: Number(targetSlot),
        type: String(type),
      },
    };
  }
  const record = asRecord(raw);
  if (!record) return null;
  return {
    id: Number(record.id),
    ends: {
      originId: Number(record.origin_id),
      originSlot: Number(record.origin_slot),
      targetId: Number(record.target_id),
      targetSlot: Number(record.target_slot),
      type: String(record.type),
    },
  };
}

/**
 * The widget values of a node, by input name. Values are listed in the order
 * of the definition's widget inputs, with an extra entry after every seed-like
 * number (its "control after generate" mode) and after every upload combo.
 */
export function widgetValuesByName(
  values: UiNode["widgets_values"],
  spec: NodeSpec,
): Map<string, unknown> {
  const byName = new Map<string, unknown>();
  if (!Array.isArray(values)) {
    for (const input of spec.inputs) {
      if (input.widget && input.name in values) byName.set(input.name, values[input.name]);
    }
    return byName;
  }
  let index = 0;
  for (const input of spec.inputs) {
    if (!input.widget) continue;
    if (index >= values.length) break;
    byName.set(input.name, values[index]);
    index += 1;
    if (hasControlWidget(input) || hasUploadWidget(input)) index += 1;
  }
  return byName;
}

/** Where a link's value really comes from, looking through reroutes, bypassed nodes and primitives. */
type Source = { kind: "node"; nodeId: number; slot: number } | { kind: "value"; value: unknown };

/** Follows a link back to the node output or primitive value that feeds it; null when nothing does. */
function resolveSource(
  linkId: number,
  nodes: Map<number, UiNode>,
  links: Map<number, LinkEnds>,
  seen: Set<number> = new Set(),
): Source | null {
  const link = links.get(linkId);
  if (!link || seen.has(linkId)) return null;
  seen.add(linkId);
  const origin = nodes.get(link.originId);
  if (!origin || origin.mode === MODE_NEVER) return null;
  if (origin.type === "PrimitiveNode") return primitiveValue(origin);
  if (origin.type === "Reroute") return followInput(origin, 0, nodes, links, seen);
  if (origin.mode === MODE_BYPASS) {
    const through = origin.inputs.findIndex(
      (input) => input.type === link.type && input.link !== null,
    );
    if (through === -1) return null;
    return followInput(origin, through, nodes, links, seen);
  }
  return { kind: "node", nodeId: origin.id, slot: link.originSlot };
}

/** The source of a node's input slot. */
function followInput(
  node: UiNode,
  slot: number,
  nodes: Map<number, UiNode>,
  links: Map<number, LinkEnds>,
  seen: Set<number>,
): Source | null {
  const input = node.inputs[slot];
  if (!input || input.link === null) return null;
  return resolveSource(input.link, nodes, links, seen);
}

/** A primitive node's value: the first of its widget values. */
function primitiveValue(node: UiNode): Source | null {
  if (!Array.isArray(node.widgets_values) || node.widgets_values.length === 0) return null;
  return { kind: "value", value: node.widgets_values[0] };
}

/** Converts a UI-format graph to the API format ComfyUI queues. */
export function uiToApi(graph: ComfyGraph, definitions: ComfyNodeDefinitions): ConversionResult {
  const { nodes, links } = readGraph(graph);
  const workflow: ComfyWorkflow = {};
  const warnings: string[] = [];
  for (const node of nodes.values()) {
    if (node.mode === MODE_NEVER || node.mode === MODE_BYPASS || FRONTEND_ONLY.has(node.type)) {
      continue;
    }
    const spec = nodeSpec(definitions, node.type);
    if (!spec)
      warnings.push(`${node.type} (${node.id}) is not installed; its widget values are dropped`);
    workflow[String(node.id)] = apiNode(node, spec, nodes, links);
  }
  return { workflow, warnings };
}

/** One UI node as an API node: its widget values, then its links over them. */
function apiNode(
  node: UiNode,
  spec: NodeSpec | null,
  nodes: Map<number, UiNode>,
  links: Map<number, LinkEnds>,
): ComfyWorkflowNode {
  const inputs: Record<string, unknown> = {};
  if (spec) {
    for (const [name, value] of widgetValuesByName(node.widgets_values, spec)) inputs[name] = value;
  }
  for (const slot of node.inputs) {
    if (slot.link === null) continue;
    const source = resolveSource(slot.link, nodes, links);
    const name = slot.widget ? slot.widget.name : slot.name;
    if (!source) continue;
    if (source.kind === "value") inputs[name] = source.value;
    if (source.kind === "node") inputs[name] = [String(source.nodeId), source.slot];
  }
  let title = node.title;
  if (title === undefined && spec) title = spec.displayName;
  const result: ComfyWorkflowNode = { class_type: node.type, inputs };
  if (title !== undefined) result._meta = { title };
  return result;
}

/** Converts an API workflow to a UI-format graph, laid out left to right by dependency. */
export function apiToUi(workflow: ComfyWorkflow, definitions: ComfyNodeDefinitions): UiGraph {
  const ids = numericIds(Object.keys(workflow));
  const nodes = new Map<string, UiNode>();
  for (const [apiId, apiNodeValue] of Object.entries(workflow)) {
    const spec = nodeSpec(definitions, apiNodeValue.class_type);
    nodes.set(apiId, uiNode(numericId(ids, apiId), apiNodeValue, spec));
  }
  const links = connect(workflow, nodes, ids, definitions);
  layout(workflow, nodes);
  let lastNodeId = 0;
  for (const node of nodes.values()) lastNodeId = Math.max(lastNodeId, node.id);
  return {
    last_node_id: lastNodeId,
    last_link_id: links.length,
    nodes: [...nodes.values()],
    links,
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  };
}

/** Numeric ids for API ids: numeric ones keep their number, others take the next free one. */
function numericIds(apiIds: string[]): Map<string, number> {
  const ids = new Map<string, number>();
  let next = 1;
  for (const apiId of apiIds) {
    if (!/^\d+$/.test(apiId)) continue;
    ids.set(apiId, Number(apiId));
    next = Math.max(next, Number(apiId) + 1);
  }
  for (const apiId of apiIds) {
    if (ids.has(apiId)) continue;
    ids.set(apiId, next);
    next += 1;
  }
  return ids;
}

/** The numeric id an API id was given. */
function numericId(ids: Map<string, number>, apiId: string): number {
  const id = ids.get(apiId);
  if (id === undefined) throw new GraphFormatError(`node ${apiId} has no id`);
  return id;
}

/** A UI node for an API node, before links and layout. */
function uiNode(id: number, node: ComfyWorkflowNode, spec: NodeSpec | null): UiNode {
  let inputs: UiInputSlot[] = [];
  let outputs: UiOutputSlot[] = [];
  let widgetsValues: unknown[] = [];
  if (spec) {
    inputs = spec.inputs
      .filter((input) => !input.widget)
      .map((input) => ({ name: input.name, type: input.type, link: null }));
    outputs = spec.outputs.map((output, index) => ({
      name: output.name,
      type: output.type,
      links: [],
      slot_index: index,
    }));
    widgetsValues = widgetValues(node, spec);
  }
  if (!spec) inputs = unknownNodeInputs(node);
  const result: UiNode = {
    id,
    type: node.class_type,
    pos: [0, 0],
    size: [NODE_WIDTH, nodeHeight(inputs.length, outputs.length, widgetsValues.length)],
    flags: {},
    order: 0,
    mode: 0,
    inputs,
    outputs,
    properties: { "Node name for S&R": node.class_type },
    widgets_values: widgetsValues,
  };
  const title = node._meta?.title;
  if (title !== undefined && (!spec || title !== spec.displayName)) result.title = title;
  return result;
}

/** A node the server does not know shows its links as slots, typed as anything. */
function unknownNodeInputs(node: ComfyWorkflowNode): UiInputSlot[] {
  const inputs: UiInputSlot[] = [];
  for (const [name, value] of Object.entries(node.inputs)) {
    if (isLink(value)) inputs.push({ name, type: "*", link: null });
  }
  return inputs;
}

/** The widget values list for an API node, with the frontend's extra entries in place. */
function widgetValues(node: ComfyWorkflowNode, spec: NodeSpec): unknown[] {
  const values: unknown[] = [];
  for (const input of spec.inputs) {
    if (!input.widget) continue;
    let value = node.inputs[input.name];
    if (value === undefined || isLink(value)) value = defaultValue(input);
    values.push(value);
    if (hasControlWidget(input)) values.push(CONTROL_DEFAULT);
    if (hasUploadWidget(input)) values.push(UPLOAD_DEFAULT);
  }
  return values;
}

/** What a widget shows before anyone sets it. */
export function defaultValue(input: InputSpec): unknown {
  if (input.config.default !== undefined) return input.config.default;
  if (input.options && input.options.length > 0) return input.options[0];
  if (input.type === "INT" || input.type === "FLOAT") return 0;
  if (input.type === "BOOLEAN") return false;
  return "";
}

/** Rough height of a node, so a laid-out graph does not overlap. */
function nodeHeight(inputs: number, outputs: number, widgets: number): number {
  return TITLE_HEIGHT + ROW_HEIGHT * (Math.max(inputs, outputs) + widgets) + 10;
}

/** Creates the links between UI nodes, adding a widget slot for a widget fed by a link. */
function connect(
  workflow: ComfyWorkflow,
  nodes: Map<string, UiNode>,
  ids: Map<string, number>,
  definitions: ComfyNodeDefinitions,
): UiLink[] {
  const links: UiLink[] = [];
  for (const [apiId, apiNodeValue] of Object.entries(workflow)) {
    const target = nodes.get(apiId);
    if (!target) continue;
    const spec = nodeSpec(definitions, apiNodeValue.class_type);
    for (const [name, value] of Object.entries(apiNodeValue.inputs)) {
      if (!isLink(value)) continue;
      const origin = nodes.get(String(value[0]));
      if (!origin) continue;
      const slotIndex = targetSlot(target, name, spec);
      const linkId = links.length + 1;
      const type = outputType(origin, value[1]);
      const slot = target.inputs[slotIndex];
      if (slot) slot.link = linkId;
      const output = origin.outputs[value[1]];
      if (output) output.links = [...(output.links ?? []), linkId];
      links.push([linkId, numericId(ids, String(value[0])), value[1], target.id, slotIndex, type]);
    }
  }
  return links;
}

/** The input slot a link lands on, adding one when a widget takes the link. */
function targetSlot(target: UiNode, name: string, spec: NodeSpec | null): number {
  const existing = target.inputs.findIndex((slot) => slot.name === name);
  if (existing !== -1) return existing;
  let type = "*";
  const input = spec?.inputs.find((candidate) => candidate.name === name);
  if (input) type = input.type;
  target.inputs.push({ name, type, link: null, widget: { name } });
  return target.inputs.length - 1;
}

/** The type of one of a node's outputs; `*` for an output the node does not declare. */
function outputType(node: UiNode, slot: number): string {
  const output = node.outputs[slot];
  if (output) return output.type;
  return "*";
}

/**
 * Places nodes in columns by their longest chain of inputs, so data flows
 * left to right, and stacks each column top to bottom.
 */
function layout(workflow: ComfyWorkflow, nodes: Map<string, UiNode>): void {
  const depths = new Map<string, number>();
  const columns = new Map<number, number>();
  let order = 0;
  for (const apiId of Object.keys(workflow)) {
    const depth = nodeDepth(apiId, workflow, depths, new Set());
    const node = nodes.get(apiId);
    if (!node) continue;
    let y = columns.get(depth);
    if (y === undefined) y = 0;
    node.pos = [depth * COLUMN_WIDTH, y];
    columns.set(depth, y + node.size[1] + NODE_GAP);
  }
  const byDepth = [...nodes.entries()].sort(
    ([left], [right]) => (depths.get(left) ?? 0) - (depths.get(right) ?? 0),
  );
  for (const [, node] of byDepth) {
    node.order = order;
    order += 1;
  }
}

/** How many links deep a node sits: 0 for one fed by nothing. */
function nodeDepth(
  apiId: string,
  workflow: ComfyWorkflow,
  depths: Map<string, number>,
  visiting: Set<string>,
): number {
  const known = depths.get(apiId);
  if (known !== undefined) return known;
  const node = workflow[apiId];
  if (!node || visiting.has(apiId)) return 0;
  visiting.add(apiId);
  let depth = 0;
  for (const value of Object.values(node.inputs)) {
    if (!isLink(value)) continue;
    depth = Math.max(depth, nodeDepth(String(value[0]), workflow, depths, visiting) + 1);
  }
  visiting.delete(apiId);
  depths.set(apiId, depth);
  return depth;
}
