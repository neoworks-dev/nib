import { describe, expect, test } from "bun:test";
import { fuzzyRank, fuzzyScore, fuzzyScorePath } from "../src/fuzzy";

describe("fuzzyScore", () => {
  test("rejects candidates that miss a character", () => {
    expect(fuzzyScore("composer.ts", "cmz")).toBeNull();
  });

  test("scores consecutive runs above scattered hits", () => {
    const consecutive = fuzzyScore("reduce", "red")!;
    const scattered = fuzzyScore("renderer-diff", "red")!;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  test("an empty query matches everything with a neutral score", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });
});

describe("fuzzyScorePath", () => {
  test("a filename query beats the same characters spread over the path", () => {
    const basenameHit = fuzzyScorePath("src/lib/client/composer-trigger.ts", "composer")!;
    const pathHit = fuzzyScorePath("src/components/post/order.ts", "composer")!;
    expect(basenameHit).toBeGreaterThan(pathHit);
  });

  test("directories in the path still match", () => {
    expect(fuzzyScorePath("packages/protocol/src/reduce.ts", "protoreduce")).not.toBeNull();
  });
});

describe("fuzzyRank", () => {
  test("ranks by score and honours the limit", () => {
    const files = [
      "src/app.css",
      "src/lib/client/Composer.svelte",
      "docs/composer.md",
      "unrelated.txt",
    ];
    const ranked = fuzzyRank(files, "composer", (file) => file, 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.item).toBe("docs/composer.md");
    expect(ranked.map((match) => match.item)).not.toContain("unrelated.txt");
  });
});
