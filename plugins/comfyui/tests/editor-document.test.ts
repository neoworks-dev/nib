import { describe, expect, it } from "bun:test";
import { bundledWorkflows, type InputSpec } from "@nib-ui/comfy";
import type { ComfyParameter, ComfyWorkflowManifest } from "@nib-ui/ui-contracts";
import {
  buildManifest,
  exposeInput,
  hideInput,
  manifestFromImport,
  parameterKindFor,
  readImport,
  slugify,
} from "../src/editor/document";

/** An input spec with the given fields over an `INT` widget. */
function input(fields: Partial<InputSpec>): InputSpec {
  return {
    name: "steps",
    type: "INT",
    required: true,
    widget: true,
    options: null,
    config: {},
    ...fields,
  };
}

/** The bundled upscale workflow, a copy a test may change. */
function upscaleManifest(): ComfyWorkflowManifest {
  const manifest = bundledWorkflows().find((candidate) => candidate.id === "upscale");
  if (!manifest) throw new Error("the upscale workflow is not bundled");
  return structuredClone(manifest);
}

/** Bytes of a text. */
function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A PNG holding the given text chunks, which is all the reader looks at. */
function png(chunks: Record<string, string>): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: Uint8Array): void => {
    const length = data.length;
    parts.push((length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255);
    parts.push(...bytes(type), ...data, 0, 0, 0, 0);
  };
  for (const [keyword, text] of Object.entries(chunks)) {
    chunk("tEXt", new Uint8Array([...bytes(keyword), 0, ...bytes(text)]));
  }
  chunk("IEND", new Uint8Array());
  return new Uint8Array(parts);
}

describe("readImport", () => {
  const upscale = upscaleManifest();

  it("tells a manifest, a UI graph and an API prompt apart", () => {
    expect(readImport(bytes(JSON.stringify(upscale))).kind).toBe("manifest");
    expect(readImport(bytes(JSON.stringify({ nodes: [], links: [] }))).kind).toBe("graph");
    expect(readImport(bytes(JSON.stringify(upscale.workflow))).kind).toBe("workflow");
    expect(readImport(bytes('{"hello": 1}'))).toEqual({
      kind: "none",
      reason: "the file holds no workflow",
    });
    expect(readImport(bytes("not json")).kind).toBe("none");
  });

  it("reads the graph ComfyUI writes into a PNG, else its prompt", () => {
    const graph = { nodes: [{ id: 1, type: "LoadImage" }], links: [] };
    const both = readImport(
      png({ workflow: JSON.stringify(graph), prompt: JSON.stringify(upscale.workflow) }),
    );
    expect(both).toEqual({ kind: "graph", graph });
    const promptOnly = readImport(png({ prompt: JSON.stringify(upscale.workflow) }));
    expect(promptOnly).toEqual({ kind: "workflow", workflow: upscale.workflow });
    expect(readImport(png({ Software: "x" })).kind).toBe("none");
  });

  it("wraps a bare graph in a manifest named after the file", () => {
    const manifest = manifestFromImport(
      { kind: "graph", graph: { nodes: [] } },
      "Frost Chest.json",
    );
    expect(manifest).toMatchObject({
      id: "frost-chest",
      name: "Frost Chest",
      workflow: {},
      graph: { nodes: [] },
    });
  });
});

describe("parameters from widgets", () => {
  it("picks the kind from the input", () => {
    expect(parameterKindFor(input({ name: "seed" }))).toBe("seed");
    expect(parameterKindFor(input({}))).toBe("integer");
    expect(parameterKindFor(input({ type: "FLOAT" }))).toBe("number");
    expect(
      parameterKindFor(input({ type: "COMBO", options: ["a"], config: { image_upload: true } })),
    ).toBe("image");
    expect(parameterKindFor(input({ type: "COMBO", options: ["a"] }))).toBe("choice");
    expect(parameterKindFor(input({ type: "IMAGE", widget: false }))).toBeNull();
  });

  it("exposes a widget with its range and value, numbering a taken id, and hides it again", () => {
    let parameters: ComfyParameter[] = [];
    parameters = exposeInput(
      parameters,
      "3",
      input({ config: { min: 1, max: 100, tooltip: "Steps" } }),
      30,
    );
    parameters = exposeInput(parameters, "7", input({}), 20);
    expect(parameters).toEqual([
      {
        id: "steps",
        label: "Steps",
        kind: "integer",
        description: "Steps",
        targets: [{ nodeId: "3", input: "steps" }],
        min: 1,
        max: 100,
        default: 30,
      },
      {
        id: "steps-2",
        label: "Steps",
        kind: "integer",
        targets: [{ nodeId: "7", input: "steps" }],
        default: 20,
      },
    ]);
    // Exposing the same input twice changes nothing.
    expect(exposeInput(parameters, "3", input({}), 5)).toEqual(parameters);
    expect(hideInput(parameters, "3", "steps").map((parameter) => parameter.id)).toEqual([
      "steps-2",
    ]);
  });
});

describe("buildManifest", () => {
  it("drops parameters whose node was deleted", () => {
    const upscale = upscaleManifest();
    const workflow = structuredClone(upscale.workflow);
    delete workflow["4"];
    const manifest = buildManifest(
      { id: "mine", name: "Mine", description: "", category: "image" },
      upscale.parameters,
      workflow,
      { nodes: [] },
    );
    expect(manifest.parameters.map((parameter) => parameter.id)).toEqual(["image"]);
  });
});

describe("slugify", () => {
  it("makes an id from a name", () => {
    expect(slugify("  Frost Chest (v2)! ")).toBe("frost-chest-v2");
    expect(slugify("???")).toBe("workflow");
  });
});
