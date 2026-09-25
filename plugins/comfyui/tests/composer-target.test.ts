import { describe, expect, it } from "bun:test";
import type {
  ComfyLibraryEntry,
  ComfyWorkflowManifest,
  ComposerTargetContext,
  ComposerTargetRequest,
} from "@nib-ui/ui-contracts";
import {
  blockedReason,
  formParameters,
  promptParameter,
  runInput,
  workflowOptions,
} from "../src/composer-target";

const variation: ComfyWorkflowManifest = {
  id: "variation",
  name: "Asset variation",
  description: "A new version of an asset",
  category: "image",
  parameters: [
    { id: "image", label: "Asset", kind: "image", targets: [{ nodeId: "1", input: "image" }] },
    {
      id: "prompt",
      label: "Prompt",
      kind: "text",
      multiline: true,
      targets: [{ nodeId: "2", input: "text" }],
    },
    {
      id: "negative",
      label: "Negative",
      kind: "text",
      default: "blurry",
      targets: [{ nodeId: "4", input: "text" }],
    },
    { id: "seed", label: "Seed", kind: "seed", targets: [{ nodeId: "3", input: "seed" }] },
  ],
  workflow: {},
};

const texture: ComfyWorkflowManifest = {
  ...variation,
  id: "texture",
  name: "Tileable texture",
  parameters: variation.parameters.filter((parameter) => parameter.kind !== "image"),
};

/** A library entry that ComfyUI can run. */
function entry(manifest: ComfyWorkflowManifest): ComfyLibraryEntry {
  return {
    source: "bundled",
    manifest,
    availability: { available: true, missingNodes: [], missingValues: [] },
  };
}

const fromPicture: ComposerTargetContext = {
  cwd: "/project",
  boardDirectory: "art",
  sources: ["art/sprite.png"],
  at: { x: 10, y: 20 },
};
const fromBoard: ComposerTargetContext = { ...fromPicture, sources: [], at: null };

/** A request for the variation workflow. */
function request(
  context: ComposerTargetContext,
  text: string,
  values: Record<string, unknown> = {},
): ComposerTargetRequest {
  return { optionId: "bundled:variation", text, values, context };
}

describe("workflowOptions", () => {
  it("offers only workflows that take a picture when asked from one", () => {
    const entries = [entry(variation), entry(texture)];
    expect(workflowOptions(entries, fromPicture).map((option) => option.id)).toEqual([
      "bundled:variation",
    ]);
    expect(workflowOptions(entries, fromBoard)).toHaveLength(2);
  });

  it("shows a workflow ComfyUI cannot run, disabled, with why", () => {
    const missing = {
      ...entry(variation),
      availability: { available: false, missingNodes: ["LoadImage"], missingValues: [] },
    };
    expect(workflowOptions([missing], fromPicture)[0]).toMatchObject({
      disabled: true,
      hint: "Missing nodes LoadImage",
    });
  });
});

describe("formParameters", () => {
  it("leaves out the prompt, and the picture when a card fills it", () => {
    expect(promptParameter(variation)?.id).toBe("prompt");
    expect(formParameters(variation, fromPicture).map((parameter) => parameter.id)).toEqual([
      "negative",
      "seed",
    ]);
    expect(formParameters(variation, fromBoard).map((parameter) => parameter.id)).toEqual([
      "image",
      "negative",
      "seed",
    ]);
  });
});

describe("blockedReason", () => {
  it("asks for the prompt until there is text", () => {
    expect(blockedReason(entry(variation), request(fromPicture, ""))).toBe("Needs prompt");
    expect(blockedReason(entry(variation), request(fromPicture, "a knight"))).toBeNull();
  });

  it("asks for the picture when no card gave one", () => {
    expect(blockedReason(entry(variation), request(fromBoard, "a knight"))).toBe("Needs asset");
  });
});

describe("runInput", () => {
  it("fills the prompt and picture and places the result where it was asked for", () => {
    const input = runInput(entry(variation), request(fromPicture, "a knight", { negative: "" }));
    expect(input).toEqual({
      cwd: "/project",
      source: "bundled",
      workflowId: "variation",
      values: { image: "art/sprite.png", prompt: "a knight" },
      at: { x: 10, y: 20 },
    });
  });

  it("sends a result with no picture to sit beside into the board on screen", () => {
    const input = runInput(entry(texture), {
      ...request(fromBoard, "moss"),
      optionId: "bundled:texture",
    });
    expect(input.outputDirectory).toBe("art");
    expect(input.at).toBeUndefined();
    expect(input.values).toEqual({ prompt: "moss", negative: "blurry" });
  });
});
