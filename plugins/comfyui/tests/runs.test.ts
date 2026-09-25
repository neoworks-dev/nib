import { describe, expect, it } from "bun:test";
import type { ComfyRun } from "@nib-ui/ui-contracts";
import { describeRun, isActive, upsertRun } from "../src/runs";

/** A run with the given fields over a queued one. */
function run(fields: Partial<ComfyRun>): ComfyRun {
  return {
    id: "run-1",
    cwd: "/project",
    label: null,
    inputs: [],
    slot: null,
    status: "queued",
    queuedAt: 1,
    finishedAt: null,
    nodeId: null,
    nodeType: null,
    progress: null,
    outputs: [],
    error: null,
    ...fields,
  };
}

describe("upsertRun", () => {
  it("replaces a run by id and keeps the newest first", () => {
    const older = run({ id: "a", queuedAt: 1 });
    const newer = run({ id: "b", queuedAt: 2 });
    const runs = upsertRun(upsertRun([], older), newer);
    expect(runs.map((entry) => entry.id)).toEqual(["b", "a"]);

    const updated = upsertRun(runs, { ...older, status: "running" });
    expect(updated.map((entry) => `${entry.id}:${entry.status}`)).toEqual([
      "b:queued",
      "a:running",
    ]);
  });
});

describe("describeRun", () => {
  it("names the executing node and its steps", () => {
    const running = run({
      status: "running",
      nodeId: "3",
      nodeType: "KSampler",
      progress: { value: 12, max: 30 },
    });
    expect(describeRun(running)).toBe("Running KSampler (3) · 12/30");
    expect(describeRun({ ...running, progress: { value: 0, max: 1 } })).toBe(
      "Running KSampler (3)",
    );
  });

  it("says how a run ended", () => {
    expect(describeRun(run({ status: "succeeded", outputs: ["comfyui/a.png"] }))).toBe(
      "Saved comfyui/a.png",
    );
    expect(
      describeRun(
        run({
          status: "failed",
          error: { message: "out of memory", nodeId: "3", nodeType: "KSampler" },
        }),
      ),
    ).toBe("KSampler failed: out of memory");
    expect(isActive(run({ status: "cancelled" }))).toBe(false);
  });
});
