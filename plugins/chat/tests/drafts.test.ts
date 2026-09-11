import { describe, expect, test } from "bun:test";
import { stageReference } from "../src/drafts.svelte";

describe("staging a file into a draft", () => {
  test("an empty draft becomes the reference alone", () => {
    expect(stageReference("", "src/index.ts")).toBe("@src/index.ts ");
  });

  test("it lands after what is already typed, one space away", () => {
    expect(stageReference("look at ", "src/index.ts")).toBe("look at @src/index.ts ");
    expect(stageReference("look at", "src/index.ts")).toBe("look at @src/index.ts ");
  });

  test("a path already referenced is not repeated", () => {
    expect(stageReference("compare @src/a.ts and ", "src/a.ts")).toBe("compare @src/a.ts and ");
  });

  test("a different path in the same draft is added", () => {
    expect(stageReference("compare @src/a.ts", "src/b.ts")).toBe("compare @src/a.ts @src/b.ts ");
  });
});
