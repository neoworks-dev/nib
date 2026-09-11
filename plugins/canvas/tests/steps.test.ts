import { describe, expect, test } from "bun:test";
import type { StepDescriptor } from "@nib-ui/ui-contracts";
import { stepLines, summariseSteps } from "../src/steps";

const read: StepDescriptor = {
  label: "Explore",
  noun: "file",
  verb: "Read",
  detail: "graph.ts",
  subject: "src/graph.ts",
};
const search: StepDescriptor = {
  label: "Explore",
  noun: "search",
  verb: "Searched for",
  detail: "todo",
  subject: "todo",
};
const run: StepDescriptor = {
  label: "Terminal",
  noun: "command",
  verb: "Ran",
  detail: "bun test",
  subject: "bun test",
};

describe("summariseSteps", () => {
  test("counts each kind of work in the order it first happened", () => {
    expect(summariseSteps([read, run, read, search])).toBe("2 files · 1 command · 1 search");
  });

  test("an edge with no work says nothing", () => {
    expect(summariseSteps([])).toBe("");
  });
});

describe("stepLines", () => {
  test("spells the work out and counts what it left off", () => {
    const lines = stepLines([read, run, search], 2);

    expect(lines).toEqual(["Read graph.ts", "Ran bun test", "+1 more"]);
  });
});
