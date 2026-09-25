import { describe, expect, it } from "bun:test";
import type { ComfyWorkflowManifest } from "@nib-ui/ui-contracts";
import { applyParameters } from "../src/parameters";

/** An img2img manifest covering every parameter kind. */
function manifest(): ComfyWorkflowManifest {
  return {
    id: "test",
    name: "Test",
    description: "",
    category: "image",
    parameters: [
      { id: "image", label: "Image", kind: "image", targets: [{ nodeId: "1", input: "image" }] },
      {
        id: "prompt",
        label: "Prompt",
        kind: "text",
        targets: [
          { nodeId: "2", input: "text" },
          { nodeId: "3", input: "text" },
        ],
      },
      { id: "seed", label: "Seed", kind: "seed", targets: [{ nodeId: "4", input: "seed" }] },
      {
        id: "strength",
        label: "Strength",
        kind: "number",
        default: 0.5,
        min: 0,
        max: 1,
        targets: [{ nodeId: "4", input: "denoise" }],
      },
      {
        id: "steps",
        label: "Steps",
        kind: "integer",
        default: 20,
        min: 1,
        targets: [{ nodeId: "4", input: "steps" }],
      },
      {
        id: "sampler",
        label: "Sampler",
        kind: "choice",
        default: "euler",
        options: ["euler", "dpmpp_2m"],
        targets: [{ nodeId: "4", input: "sampler_name" }],
      },
      {
        id: "tile",
        label: "Tile",
        kind: "boolean",
        default: false,
        targets: [{ nodeId: "5", input: "tile" }],
      },
    ],
    workflow: {
      "1": { class_type: "LoadImage", inputs: { image: "" } },
      "2": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "3": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "4": {
        class_type: "KSampler",
        inputs: { seed: 0, denoise: 1, steps: 20, sampler_name: "euler" },
      },
      "5": { class_type: "Tiler", inputs: { tile: false } },
    },
  };
}

describe("applyParameters", () => {
  it("writes values into every target and lists uploads", () => {
    const source = manifest();
    const applied = applyParameters(
      source,
      {
        image: "art/chest.png",
        prompt: "frost",
        seed: 7,
        strength: "0.25",
        sampler: "dpmpp_2m",
        tile: true,
      },
      () => 0.5,
    );
    expect(applied.issues).toEqual([]);
    expect(applied.uploads).toEqual([{ nodeId: "1", input: "image", path: "art/chest.png" }]);
    expect(applied.workflow["2"]!.inputs.text).toBe("frost");
    expect(applied.workflow["3"]!.inputs.text).toBe("frost");
    expect(applied.workflow["4"]!.inputs).toEqual({
      seed: 7,
      denoise: 0.25,
      steps: 20,
      sampler_name: "dpmpp_2m",
    });
    expect(applied.workflow["5"]!.inputs.tile).toBe(true);
    // The library's copy is left alone.
    expect(source.workflow["2"]!.inputs.text).toBe("");
  });

  it("draws a seed when none is given", () => {
    const applied = applyParameters(manifest(), { image: "a.png", prompt: "x" }, () => 0.25);
    expect(applied.workflow["4"]!.inputs.seed).toBe(2 ** 30);
  });

  it("says which values do not fit", () => {
    const applied = applyParameters(manifest(), {
      prompt: 3,
      strength: 2,
      steps: 1.5,
      sampler: "heun",
      tile: "yes",
      colour: "red",
    });
    expect(applied.issues.map((issue) => issue.message)).toEqual([
      "Test has no parameter colour",
      "Image: a value is required",
      "Prompt: expected text",
      "Strength: above the maximum of 1",
      "Steps: expected a whole number",
      "Sampler: heun is not one of euler, dpmpp_2m",
      "Tile: expected true or false",
    ]);
    expect(applied.issues.every((issue) => issue.code === "invalid_parameter")).toBe(true);
  });
});
