import { describe, expect, test } from "bun:test";
import { mapSupportedModels } from "../src/mapping";

describe("mapSupportedModels", () => {
  test("offers each CLI row under the value `--model` takes", () => {
    expect(
      mapSupportedModels([
        {
          value: "default",
          resolvedModel: "claude-opus-5-5",
          displayName: "Default (recommended)",
          description: "Opus 5.5 with 1M context",
        },
        { value: "sonnet", displayName: "Sonnet", description: "Sonnet 5 for everyday tasks" },
      ]),
    ).toEqual([
      {
        id: "default",
        displayName: "Default (recommended)",
        description: "Opus 5.5 with 1M context",
      },
      { id: "sonnet", displayName: "Sonnet", description: "Sonnet 5 for everyday tasks" },
    ]);
  });
});
