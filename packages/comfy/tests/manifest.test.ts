import { describe, expect, it } from "bun:test";
import { bundledWorkflows } from "../src/bundled";
import { parseManifest } from "../src/manifest";
import { validateWorkflow, workflowAvailability } from "../src/validate";
import { applyParameters } from "../src/parameters";
import { definitions } from "./helpers";

const defs = definitions();

describe("parseManifest", () => {
  it("rejects a malformed file with the field at fault", () => {
    const parsed = parseManifest({ id: "Bad Id", name: "x", description: "", category: "image" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("id");
    expect(parsed.error).toContain("parameters");
  });

  it("rejects parameters that point nowhere", () => {
    const parsed = parseManifest({
      id: "broken",
      name: "Broken",
      description: "",
      category: "image",
      parameters: [
        { id: "a", label: "A", kind: "text", targets: [{ nodeId: "9", input: "text" }] },
        { id: "a", label: "A again", kind: "choice", targets: [{ nodeId: "1", input: "nope" }] },
      ],
      workflow: { "1": { class_type: "CLIPTextEncode", inputs: { text: "" } } },
    });
    expect(parsed).toEqual({
      ok: false,
      error: [
        "parameter a targets node 9, which is not in the workflow",
        "parameter a is declared twice",
        "parameter a is a choice without options",
        "parameter a targets CLIPTextEncode (1).nope, which the node does not set",
      ].join("\n"),
    });
  });
});

describe("bundled workflows", () => {
  const manifests = bundledWorkflows();

  it("are the initial set", () => {
    expect(manifests.map((manifest) => manifest.id).sort()).toEqual([
      "asset-variation",
      "image-to-3d",
      "remove-background",
      "tileable-texture",
      "upscale",
    ]);
  });

  for (const manifest of manifests) {
    it(`${manifest.id} is available and valid with its defaults on ComfyUI 0.33`, () => {
      expect(workflowAvailability(manifest.workflow, manifest.parameters, defs)).toEqual({
        available: true,
        missingNodes: [],
        missingValues: [],
      });
      const values: Record<string, unknown> = {};
      for (const parameter of manifest.parameters) {
        if (parameter.kind === "image") values[parameter.id] = "nib-test-chest.png";
        if (parameter.kind === "text" && parameter.default === undefined)
          values[parameter.id] = "x";
      }
      const applied = applyParameters(manifest, values);
      expect(applied.issues).toEqual([]);
      expect(validateWorkflow(applied.workflow, defs)).toEqual([]);
    });
  }
});
