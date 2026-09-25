import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComfyGraph, ComfyNodeDefinitions } from "@nib-ui/ui-contracts";

const FIXTURES = join(import.meta.dir, "fixtures");

/** A trimmed `/object_info` from ComfyUI 0.33 with the nodes the fixtures and bundled workflows use. */
export function definitions(): ComfyNodeDefinitions {
  return JSON.parse(readFileSync(join(FIXTURES, "object_info.json"), "utf8"));
}

/** A UI-format workflow exported from ComfyUI, by fixture name. */
export function uiFixture(name: string): ComfyGraph {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.ui.json`), "utf8"));
}
