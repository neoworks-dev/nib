/**
 * ComfyUI's node classes as litegraph node types, built from `/object_info` the
 * way ComfyUI's own frontend builds them — the same slots, and the same widgets
 * in the same order — so a graph saved by either loads in the other.
 */

import { LGraphNode, LiteGraph } from "@comfyorg/litegraph";
import {
  allNodeSpecs,
  defaultValue,
  hasControlWidget,
  hasUploadWidget,
  type InputSpec,
  type NodeSpec,
} from "@nib-ui/comfy";
import type { ComfyNodeDefinitions } from "@nib-ui/ui-contracts";

/** What a seed does after each run, as ComfyUI's frontend offers it. */
export const CONTROL_VALUES = ["fixed", "increment", "decrement", "randomize"];
/** The name of the widget holding that choice. */
export const CONTROL_WIDGET = "control_after_generate";

/** Frontend-only node types that exported graphs use and the server never sees. */
const NOTE_TYPES = ["Note", "MarkdownNote"];

/** Registers every node class the server has; the disposer removes them again. */
export function registerNodeTypes(
  definitions: ComfyNodeDefinitions,
  onChange: () => void,
): () => void {
  const registered: string[] = [];
  for (const spec of allNodeSpecs(definitions)) {
    const nodeClass = comfyNodeClass(spec, onChange);
    LiteGraph.registerNodeType(spec.name, nodeClass);
    // Registration derives the category from a `/` in the type, which ComfyUI's names lack.
    nodeClass.category = spec.category;
    registered.push(spec.name);
  }
  for (const type of NOTE_TYPES) {
    if (type in LiteGraph.registered_node_types) continue;
    LiteGraph.registerNodeType(type, noteClass(type, onChange));
    registered.push(type);
  }
  return () => {
    for (const type of registered) LiteGraph.unregisterNodeType(type);
  };
}

/** A node class for one ComfyUI node type. */
function comfyNodeClass(spec: NodeSpec, onChange: () => void): typeof LGraphNode {
  return class ComfyNode extends LGraphNode {
    static override title = spec.displayName;
    static override category = spec.category;

    constructor(title?: string) {
      super(title ?? spec.displayName, spec.name);
      this.comfyClass = spec.name;
      this.serialize_widgets = true;
      for (const input of spec.inputs) {
        if (input.widget) addWidgetFor(this, input, onChange);
        if (!input.widget) this.addInput(input.name, input.type);
      }
      for (const output of spec.outputs) this.addOutput(output.name, output.type);
      this.setSize(this.computeSize());
    }
  };
}

/** A note: a text widget and no slots. */
function noteClass(type: string, onChange: () => void): typeof LGraphNode {
  return class NoteNode extends LGraphNode {
    static override title = type;

    constructor(title?: string) {
      super(title ?? type, type);
      this.serialize_widgets = true;
      this.addWidget("text", "text", "", onChange, { multiline: true });
      this.setSize([320, 120]);
    }
  };
}

/**
 * The widget for one input, followed by the extra widget ComfyUI adds after a
 * seed (what to do with it after a run) or a picture (its upload button).
 */
function addWidgetFor(node: LGraphNode, input: InputSpec, onChange: () => void): void {
  const value = defaultValue(input);
  if (input.type === "COMBO") {
    node.addWidget("combo", input.name, String(value), onChange, { values: input.options ?? [] });
  }
  if (input.type === "INT" || input.type === "FLOAT") addNumberWidget(node, input, onChange);
  if (input.type === "BOOLEAN") {
    node.addWidget("toggle", input.name, value === true, onChange, { on: "true", off: "false" });
  }
  if (input.type === "STRING") {
    node.addWidget("text", input.name, String(value), onChange, {
      multiline: input.config.multiline === true,
    });
  }
  if (hasControlWidget(input)) {
    node.addWidget("combo", CONTROL_WIDGET, "fixed", onChange, { values: CONTROL_VALUES });
  }
  if (hasUploadWidget(input)) node.addWidget("button", "upload", "image", () => {});
}

/** A number widget with the input's range; whole numbers for `INT`. */
function addNumberWidget(node: LGraphNode, input: InputSpec, onChange: () => void): void {
  const { min, max, step } = input.config;
  const options: { min?: number; max?: number; step2?: number; precision?: number } = {};
  if (typeof min === "number") options.min = min;
  if (typeof max === "number") options.max = max;
  if (typeof step === "number") options.step2 = step;
  if (input.type === "INT") {
    options.precision = 0;
    if (options.step2 === undefined) options.step2 = 1;
  }
  const value = defaultValue(input);
  node.addWidget("number", input.name, typeof value === "number" ? value : 0, onChange, options);
}
