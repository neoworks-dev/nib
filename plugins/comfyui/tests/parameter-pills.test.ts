import { describe, expect, test } from "bun:test";
import type { ComfyParameter } from "@nib-ui/ui-contracts";
import { promptPlaceholder } from "../src/composer-target";
import {
  integerChoices,
  parameterPillLabel,
  sizeLabel,
  sizePair,
  sizePresets,
} from "../src/parameter-pills";

/** A parameter with only what a test cares about. */
function parameter(fields: Partial<ComfyParameter> & Pick<ComfyParameter, "id">): ComfyParameter {
  return { label: fields.id, kind: "integer", targets: [], ...fields };
}

describe("parameter pill labels", () => {
  test("a number reads as its name and value", () => {
    expect(parameterPillLabel(parameter({ id: "count", label: "Count" }), 2)).toBe("Count 2");
  });

  test("a seed left empty is random, a set one shows", () => {
    const seed = parameter({ id: "seed", label: "Seed", kind: "seed" });
    expect(parameterPillLabel(seed, "")).toBe("Random seed");
    expect(parameterPillLabel(seed, undefined)).toBe("Random seed");
    expect(parameterPillLabel(seed, 42)).toBe("Seed 42");
  });

  test("a list counts its terms, short text shows, long text is cut", () => {
    const avoid = parameter({ id: "negative", label: "Avoid", kind: "text" });
    expect(parameterPillLabel(avoid, "perspective, shadows, vignette, text")).toBe(
      "Avoid · 4 terms",
    );
    expect(parameterPillLabel(avoid, "blurry")).toBe("Avoid: blurry");
    expect(parameterPillLabel(avoid, "anything that looks out of place")).toBe(
      "Avoid: anything that lo…",
    );
    expect(parameterPillLabel(avoid, "")).toBe("Avoid");
  });

  test("a picture shows its file name", () => {
    const image = parameter({ id: "image", label: "Image", kind: "image" });
    expect(parameterPillLabel(image, "assets/chest.png")).toBe("chest.png");
    expect(parameterPillLabel(image, undefined)).toBe("Image");
  });
});

describe("integer choices", () => {
  test("a small range becomes buttons", () => {
    expect(integerChoices(parameter({ id: "count", min: 1, max: 4 }))).toEqual([1, 2, 3, 4]);
  });

  test("a wide range or an open one does not", () => {
    expect(integerChoices(parameter({ id: "steps", min: 5, max: 80 }))).toBeNull();
    expect(integerChoices(parameter({ id: "steps", min: 5 }))).toBeNull();
    expect(
      integerChoices(parameter({ id: "strength", kind: "number", min: 0, max: 1 })),
    ).toBeNull();
  });
});

describe("size pill", () => {
  const width = parameter({ id: "width", label: "Width", default: 1024, min: 256, max: 2048 });
  const height = parameter({ id: "height", label: "Height", default: 1024, min: 256, max: 2048 });

  test("width and height pair up, anything else does not", () => {
    expect(sizePair([width, height])).toEqual({ width, height });
    expect(sizePair([width])).toBeNull();
    expect(sizePair([parameter({ id: "size" })])).toBeNull();
  });

  test("presets keep to the grid around the default size", () => {
    expect(sizePresets({ width, height })).toEqual([
      { label: "Square", width: 1024, height: 1024 },
      { label: "Portrait", width: 768, height: 1024 },
      { label: "Landscape", width: 1024, height: 768 },
    ]);
  });

  test("presets stay inside the range", () => {
    const narrow = { ...width, min: 900 };
    expect(sizePresets({ width: narrow, height })[1]).toEqual({
      label: "Portrait",
      width: 900,
      height: 1024,
    });
  });

  test("the label reads as width by height", () => {
    expect(sizeLabel(1024, 768)).toBe("1024 × 768");
  });
});

describe("prompt placeholder", () => {
  test("the prompt's description wins", () => {
    const material = parameter({
      id: "prompt",
      label: "Material",
      kind: "text",
      description: 'E.g. "mossy cobblestone"',
    });
    expect(promptPlaceholder(material)).toBe('E.g. "mossy cobblestone"');
  });

  test("without one it is an instruction", () => {
    expect(promptPlaceholder(parameter({ id: "prompt", label: "Prompt", kind: "text" }))).toBe(
      "Describe what to make",
    );
    expect(promptPlaceholder(parameter({ id: "prompt", label: "Parts", kind: "text" }))).toBe(
      "Describe the parts",
    );
  });
});
