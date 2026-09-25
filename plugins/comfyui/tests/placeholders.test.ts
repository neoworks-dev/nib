import { describe, expect, it } from "bun:test";
import type { ComfyRun } from "@nib-ui/ui-contracts";
import {
  awaitingResult,
  type PlaceholderScene,
  placeholdersFor,
  SWAP_GRACE_MS,
} from "../src/placeholders";

const slot = { board: "art", x: 10, y: 20, w: 200, h: 150 };

/** A run holding `slot`, with the given fields over a queued one. */
function run(fields: Partial<ComfyRun>): ComfyRun {
  return {
    id: "run-1",
    cwd: "/project",
    label: "Upscale",
    inputs: ["art/sprite.png"],
    slot,
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

/** The scene on the `art` board with these runs. */
function scene(runs: ComfyRun[], fields: Partial<PlaceholderScene> = {}): PlaceholderScene {
  return {
    runs,
    cwd: "/project",
    boardDirectory: "art",
    shownIds: new Set(),
    now: 1_000,
    ...fields,
  };
}

describe("placeholdersFor", () => {
  it("holds the slot of a queued and a running run, with where each has got to", () => {
    const running = run({
      id: "run-2",
      status: "running",
      nodeType: "KSampler",
      progress: { value: 5, max: 20 },
    });
    expect(placeholdersFor(scene([running, run({})]))).toEqual([
      { runId: "run-1", slot, label: "Upscale", detail: "Queued", progress: null },
      { runId: "run-2", slot, label: "Upscale", detail: "25%", progress: 0.25 },
    ]);
  });

  it("draws nothing for another board, another project, or a run without a slot", () => {
    expect(placeholdersFor(scene([run({})], { boardDirectory: "" }))).toEqual([]);
    expect(placeholdersFor(scene([run({ cwd: "/other" })]))).toEqual([]);
    expect(placeholdersFor(scene([run({ slot: null })]))).toEqual([]);
  });

  it("drops a failed or cancelled run at once", () => {
    expect(
      placeholdersFor(scene([run({ status: "failed" }), run({ status: "cancelled" })])),
    ).toEqual([]);
  });

  it("keeps a succeeded run's placeholder until its card is on the board", () => {
    const done = run({ status: "succeeded", finishedAt: 1_000, outputs: ["art/a_00001_.png"] });
    expect(placeholdersFor(scene([done]))[0]?.detail).toBe("Placing the result…");
    expect(awaitingResult(scene([done]))).toBe(true);

    const arrived = scene([done], { shownIds: new Set(["art/a_00001_.png"]) });
    expect(placeholdersFor(arrived)).toEqual([]);
    expect(awaitingResult(arrived)).toBe(false);

    const late = scene([done], { now: 1_000 + SWAP_GRACE_MS });
    expect(placeholdersFor(late)).toEqual([]);
  });
});
