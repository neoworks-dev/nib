import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ComfyGraph,
  ComfyNodeDefinitions,
  ComfyWorkflow,
  ComfyWorkflowManifest,
} from "@nib-ui/ui-contracts";
import { bundledWorkflows } from "../src/bundled";

const FIXTURES = join(import.meta.dir, "fixtures");

/** A trimmed `/object_info` from ComfyUI 0.33 with the nodes the fixtures and bundled workflows use. */
export function definitions(): ComfyNodeDefinitions {
  return JSON.parse(readFileSync(join(FIXTURES, "object_info.json"), "utf8"));
}

/** The value, or a failed test when it is missing. */
export function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`expected a ${what}`);
  return value;
}

/** A bundled manifest by id. */
export function bundled(id: string): ComfyWorkflowManifest {
  return must(
    bundledWorkflows().find((manifest) => manifest.id === id),
    `bundled workflow ${id}`,
  );
}

/** The inputs of one node, for a test to change. */
export function inputsOf(workflow: ComfyWorkflow, nodeId: string): Record<string, unknown> {
  return must(workflow[nodeId], `node ${nodeId}`).inputs;
}

/** A UI-format workflow exported from ComfyUI, by fixture name. */
export function uiFixture(name: string): ComfyGraph {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.ui.json`), "utf8"));
}
