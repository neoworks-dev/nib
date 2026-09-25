import { describe, expect, it } from "bun:test";
import type { ComfyLibraryEntry, ComfyWorkflowManifest } from "@nib-ui/ui-contracts";
import {
  describeAvailability,
  errorMessage,
  filterEntries,
  groupByCategory,
  initialValues,
  missingRequired,
  valuesToSend,
} from "../src/form";

/** A manifest with the given fields over an image workflow. */
function manifest(fields: Partial<ComfyWorkflowManifest>): ComfyWorkflowManifest {
  return {
    id: "variation",
    name: "Asset variation",
    description: "A new version of an asset",
    category: "image",
    parameters: [
      { id: "image", label: "Asset", kind: "image", targets: [{ nodeId: "1", input: "image" }] },
      { id: "prompt", label: "Prompt", kind: "text", targets: [{ nodeId: "2", input: "text" }] },
      {
        id: "strength",
        label: "Strength",
        kind: "number",
        default: 0.5,
        targets: [{ nodeId: "3", input: "denoise" }],
      },
      {
        id: "seed",
        label: "Seed",
        kind: "seed",
        default: 4,
        targets: [{ nodeId: "3", input: "seed" }],
      },
    ],
    workflow: {},
    ...fields,
  };
}

/** A bundled entry around a manifest. */
function entry(fields: Partial<ComfyWorkflowManifest>): ComfyLibraryEntry {
  return { source: "bundled", manifest: manifest(fields), availability: null };
}

describe("filterEntries", () => {
  const entries = [
    entry({}),
    entry({ id: "texture", name: "Tileable texture", category: "texture", parameters: [] }),
  ];

  it("matches every word against name, description and category", () => {
    expect(filterEntries(entries, "tile tex", false).map((found) => found.manifest.id)).toEqual([
      "texture",
    ]);
    expect(filterEntries(entries, "", false)).toHaveLength(2);
  });

  it("keeps only workflows that take a picture when opened for one", () => {
    expect(filterEntries(entries, "", true).map((found) => found.manifest.id)).toEqual([
      "variation",
    ]);
  });

  it("groups by category in first-seen order", () => {
    expect(groupByCategory(entries).map((group) => group.category)).toEqual(["image", "texture"]);
  });
});

describe("the form", () => {
  it("starts from defaults and the picture, leaving the seed to chance", () => {
    expect(initialValues(manifest({}), "art/chest.png")).toEqual({
      image: "art/chest.png",
      strength: 0.5,
    });
  });

  it("names what is still missing and leaves empty fields out", () => {
    const values = { image: "art/chest.png", prompt: "", strength: 0.5 };
    expect(missingRequired(manifest({}), values).map((parameter) => parameter.id)).toEqual([
      "prompt",
    ]);
    expect(valuesToSend(values)).toEqual({ image: "art/chest.png", strength: 0.5 });
  });
});

describe("errorMessage", () => {
  it("unwraps the server's error body", () => {
    expect(errorMessage(new Error('{"message":"ComfyUI is not reachable"}'))).toBe(
      "ComfyUI is not reachable",
    );
    expect(errorMessage(new Error("plain"))).toBe("plain");
  });
});

describe("describeAvailability", () => {
  it("names missing nodes and files once each", () => {
    expect(
      describeAvailability({
        available: false,
        missingNodes: ["SeamlessTile"],
        missingValues: [
          {
            nodeId: "1",
            nodeType: "CheckpointLoaderSimple",
            input: "ckpt_name",
            value: "sdxl.safetensors",
          },
          {
            nodeId: "2",
            nodeType: "CheckpointLoaderSimple",
            input: "ckpt_name",
            value: "sdxl.safetensors",
          },
        ],
      }),
    ).toBe("Missing nodes SeamlessTile; sdxl.safetensors");
    expect(
      describeAvailability({ available: true, missingNodes: [], missingValues: [] }),
    ).toBeNull();
    expect(describeAvailability(null)).toBeNull();
  });
});
