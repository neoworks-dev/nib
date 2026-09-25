import { describe, expect, it } from "bun:test";
import type { ComfyWorkflow } from "@nib-ui/ui-contracts";
import { validateWorkflow, workflowAvailability } from "../src/validate";
import { definitions } from "./helpers";

const defs = definitions();

/** A valid SDXL text-to-image graph to break in each test. */
function textToImage(): ComfyWorkflow {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "RealVisXL_V5.0_fp16.safetensors" },
    },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "a chest", clip: ["1", 1] } },
    "3": { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "4": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        seed: 1,
        steps: 20,
        cfg: 5,
        sampler_name: "euler",
        scheduler: "normal",
        positive: ["2", 0],
        negative: ["2", 0],
        latent_image: ["3", 0],
        denoise: 1,
      },
    },
    "5": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["1", 2] } },
    "6": { class_type: "SaveImage", inputs: { images: ["5", 0], filename_prefix: "x" } },
  };
}

describe("validateWorkflow", () => {
  it("accepts a valid graph", () => {
    expect(validateWorkflow(textToImage(), defs)).toEqual([]);
  });

  it("names a node class the server lacks", () => {
    const workflow = textToImage();
    workflow["7"] = { class_type: "NotInstalled", inputs: {} };
    expect(validateWorkflow(workflow, defs)).toEqual([
      {
        code: "unknown_node",
        message: "NotInstalled is not installed",
        nodeId: "7",
        nodeType: "NotInstalled",
        input: null,
      },
    ]);
  });

  it("reports a link of the wrong type with both types", () => {
    const workflow = textToImage();
    workflow["4"]!.inputs.positive = ["1", 1];
    const [found] = validateWorkflow(workflow, defs);
    expect(found).toMatchObject({
      code: "type_mismatch",
      nodeId: "4",
      input: "positive",
      expected: "CONDITIONING",
      actual: "CLIP",
    });
  });

  it("reports links to missing nodes and outputs", () => {
    const workflow = textToImage();
    workflow["5"]!.inputs.samples = ["99", 0];
    workflow["5"]!.inputs.vae = ["1", 7];
    const codes = validateWorkflow(workflow, defs).map((found) => `${found.code}:${found.input}`);
    expect(codes).toEqual(["bad_link:samples", "bad_link:vae"]);
  });

  it("reports missing inputs, bad values and unknown inputs", () => {
    const workflow = textToImage();
    delete workflow["4"]!.inputs.cfg;
    workflow["4"]!.inputs.steps = 2.5;
    workflow["4"]!.inputs.denoise = 3;
    workflow["4"]!.inputs.sampler_name = "nope";
    workflow["4"]!.inputs.colour = "red";
    const found = validateWorkflow(workflow, defs).map((issue) => `${issue.code}:${issue.input}`);
    expect(found).toEqual([
      "invalid_value:steps",
      "missing_input:cfg",
      "invalid_value:sampler_name",
      "invalid_value:denoise",
      "unknown_input:colour",
    ]);
  });

  it("tells a missing model apart from a bad option", () => {
    const workflow = textToImage();
    workflow["1"]!.inputs.ckpt_name = "sd_xl_base_1.0.safetensors";
    const [found] = validateWorkflow(workflow, defs);
    expect(found).toMatchObject({
      code: "missing_value",
      input: "ckpt_name",
      actual: "sd_xl_base_1.0.safetensors",
    });
  });

  it("wants an output node", () => {
    const workflow = textToImage();
    delete workflow["6"];
    expect(validateWorkflow(workflow, defs).map((found) => found.code)).toEqual(["no_outputs"]);
  });

  it("skips values filled in later", () => {
    const workflow: ComfyWorkflow = {
      "1": { class_type: "LoadImage", inputs: { image: "comfyui/in-the-vault.png" } },
      "2": { class_type: "PreviewImage", inputs: { images: ["1", 0] } },
    };
    expect(validateWorkflow(workflow, defs)[0]?.code).toBe("missing_value");
    expect(validateWorkflow(workflow, defs, { skipValues: new Set(["1.image"]) })).toEqual([]);
  });
});

describe("workflowAvailability", () => {
  it("lists missing nodes and models, but not image parameters", () => {
    const workflow = textToImage();
    workflow["1"]!.inputs.ckpt_name = "sd_xl_base_1.0.safetensors";
    workflow["7"] = { class_type: "LoadImage", inputs: { image: "" } };
    workflow["8"] = { class_type: "SeamlessTileX", inputs: {} };
    const availability = workflowAvailability(
      workflow,
      [{ id: "image", label: "Image", kind: "image", targets: [{ nodeId: "7", input: "image" }] }],
      defs,
    );
    expect(availability).toEqual({
      available: false,
      missingNodes: ["SeamlessTileX"],
      missingValues: [
        {
          nodeId: "1",
          nodeType: "CheckpointLoaderSimple",
          input: "ckpt_name",
          value: "sd_xl_base_1.0.safetensors",
        },
      ],
    });
  });
});
