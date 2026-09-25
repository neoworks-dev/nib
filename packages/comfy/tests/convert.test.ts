import { describe, expect, it } from "bun:test";
import type { ComfyWorkflow } from "@nib-ui/ui-contracts";
import { bundledWorkflows } from "../src/bundled";
import { apiToUi, GraphFormatError, uiToApi } from "../src/convert";
import { validateWorkflow } from "../src/validate";
import { definitions, uiFixture } from "./helpers";

const defs = definitions();

/** The workflow without node titles, which the two directions treat differently on purpose. */
function withoutTitles(workflow: ComfyWorkflow): ComfyWorkflow {
  const stripped: ComfyWorkflow = {};
  for (const [id, node] of Object.entries(workflow)) {
    stripped[id] = { class_type: node.class_type, inputs: node.inputs };
  }
  return stripped;
}

describe("uiToApi", () => {
  it("converts a Hunyuan3D workflow exported from ComfyUI", () => {
    const { workflow, warnings } = uiToApi(uiFixture("hy3d-user"), defs);
    expect(warnings).toEqual([]);
    // The markdown note never reaches the server.
    expect(Object.values(workflow).map((node) => node.class_type)).not.toContain("MarkdownNote");
    expect(workflow["7"]).toEqual({
      class_type: "KSampler",
      inputs: {
        seed: 952805179515179,
        steps: 50,
        cfg: 5,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["3", 0],
        positive: ["6", 0],
        negative: ["6", 1],
        latent_image: ["4", 0],
      },
      _meta: { title: "KSampler" },
    });
    expect(workflow["2"]!.inputs).toEqual({ image: "ninja_tpose.png" });
    // A trailing value the frontend saves for its 3D preview is not an input.
    expect(workflow["10"]!.inputs).toEqual({ filename_prefix: "3d/ninja_tpose", mesh: ["9", 0] });
    // Only the input picture is missing on this server.
    expect(
      validateWorkflow(workflow, defs).map((found) => `${found.code}:${found.nodeType}`),
    ).toEqual(["missing_value:LoadImage"]);
  });

  it("feeds primitive values into the widgets they drive and drops notes", () => {
    const { workflow } = uiToApi(uiFixture("sdxl_simple_example"), defs);
    const types = Object.values(workflow).map((node) => node.class_type);
    expect(types).not.toContain("PrimitiveNode");
    expect(types).not.toContain("Note");
    expect(workflow["10"]!.inputs).toMatchObject({
      steps: 25,
      end_at_step: 20,
      noise_seed: 721897303308196,
    });
    expect(workflow["11"]!.inputs).toMatchObject({ steps: 25, start_at_step: 20, noise_seed: 0 });
    expect(workflow["6"]!.inputs.text).toBe(
      "evening sunset scenery blue sky nature, glass bottle with a galaxy in it",
    );
    const problems = validateWorkflow(workflow, defs).map(
      (found) => `${found.code}:${found.input}`,
    );
    expect(problems).toEqual(["missing_value:ckpt_name", "missing_value:ckpt_name"]);
  });

  it("keeps bypassed nodes out and passes their input through", () => {
    const graph = uiFixture("hy3d-user");
    const nodes = graph.nodes as { id: number; mode: number }[];
    const auraFlow = nodes.find((node) => node.id === 3)!;
    auraFlow.mode = 4;
    const { workflow } = uiToApi(graph, defs);
    expect(workflow["3"]).toBeUndefined();
    expect(workflow["7"]!.inputs.model).toEqual(["1", 0]);
  });

  it("refuses subgraphs rather than dropping them silently", () => {
    expect(() => uiToApi(uiFixture("utility_birefnet_remove_background"), defs)).toThrow(
      GraphFormatError,
    );
  });
});

describe("apiToUi", () => {
  for (const manifest of bundledWorkflows()) {
    it(`round-trips ${manifest.id}`, () => {
      const graph = apiToUi(manifest.workflow, defs);
      const { workflow } = uiToApi(graph, defs);
      expect(withoutTitles(workflow)).toEqual(withoutTitles(manifest.workflow));
    });
  }

  it("round-trips an exported workflow", () => {
    const first = uiToApi(uiFixture("hy3d-user"), defs).workflow;
    const second = uiToApi(apiToUi(first, defs), defs).workflow;
    expect(second).toEqual(first);
  });

  it("saves the frontend's extra widget values and a slot for a linked widget", () => {
    const graph = apiToUi(
      bundledWorkflows().find((manifest) => manifest.id === "image-to-3d")!.workflow,
      defs,
    );
    const sampler = graph.nodes.find((node) => node.id === 10)!;
    expect(sampler.widgets_values).toEqual([0, "fixed", 30, 5, "euler", "normal", 1]);
    const load = graph.nodes.find((node) => node.id === 2)!;
    expect(load.widgets_values).toEqual(["", "image"]);
    const backdrop = graph.nodes.find((node) => node.id === 6)!;
    expect(backdrop.title).toBe("White backdrop");
    expect(
      backdrop.inputs.map((slot) => `${slot.name}:${slot.widget?.name}:${slot.link !== null}`),
    ).toEqual(["width:width:true", "height:height:true"]);
  });

  it("lays nodes out left to right by dependency", () => {
    const graph = apiToUi(
      bundledWorkflows().find((manifest) => manifest.id === "upscale")!.workflow,
      defs,
    );
    const x = (id: number) => graph.nodes.find((node) => node.id === id)!.pos[0];
    expect(x(1)).toBe(0);
    expect(x(2)).toBe(0);
    expect(x(3)).toBeGreaterThan(x(1));
    expect(x(4)).toBeGreaterThan(x(3));
    expect(x(5)).toBeGreaterThan(x(4));
  });
});
