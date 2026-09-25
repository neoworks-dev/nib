import { describe, expect, it } from "bun:test";
import {
  MIN_PLAYING,
  type Playable,
  PlaybackBudget,
  REVIEW_MS,
  START_PLAYING,
} from "../src/engine/utils/playback";

/**
 * Decoding is paid per clip, so what is under test is which clips are allowed to
 * run at all. The element is stubbed: nothing here needs a real one, and a real
 * one would need a document.
 */
class FakeClip implements Playable {
  paused = true;
  plays = 0;

  play(): void {
    this.paused = false;
    this.plays += 1;
  }

  pause(): void {
    this.paused = true;
  }
}

/** Past the review window, so the next claim weighs the clips against each other. */
function later(now: number): number {
  return now + REVIEW_MS + 1;
}

describe("PlaybackBudget", () => {
  it("plays the clips with the most of the screen and stops the rest", () => {
    const budget = new PlaybackBudget(2);
    const big = new FakeClip();
    const medium = new FakeClip();
    const small = new FakeClip();

    budget.claim("big", big, 900, 0);
    budget.claim("medium", medium, 400, 0);
    budget.claim("small", small, 100, later(0));

    expect(budget.playing()).toEqual(["big", "medium"]);
    expect(big.paused).toBe(false);
    expect(medium.paused).toBe(false);
    expect(small.paused).toBe(true);
  });

  it("hands the budget over as a card grows past the one holding it", () => {
    const budget = new PlaybackBudget(1);
    const first = new FakeClip();
    const second = new FakeClip();

    let now = 0;
    budget.claim("first", first, 900, now);
    budget.claim("second", second, 100, now);
    now = later(now);
    budget.claim("first", first, 900, now);
    expect(first.paused).toBe(false);
    expect(second.paused).toBe(true);

    // The board zoomed in on the second card: it is now the one worth decoding.
    now = later(now);
    budget.claim("first", first, 100, now);
    budget.claim("second", second, 900, now);
    now = later(now);
    budget.claim("second", second, 900, now);

    expect(budget.playing()).toEqual(["second"]);
    expect(first.paused).toBe(true);
    expect(second.paused).toBe(false);
  });

  it("stops a released clip at once rather than at the next review", () => {
    const budget = new PlaybackBudget(2);
    const clip = new FakeClip();

    budget.claim("a", clip, 900, 0);
    budget.claim("a", clip, 900, later(0));
    expect(clip.paused).toBe(false);

    budget.release("a", later(0));
    expect(clip.paused).toBe(true);
    expect(budget.playing()).toEqual([]);
  });

  it("drops a claim nobody renewed, and stops the clip it was holding", () => {
    const budget = new PlaybackBudget(2);
    const gone = new FakeClip();
    const here = new FakeClip();

    budget.claim("gone", gone, 900, 0);
    budget.claim("here", here, 100, later(0));
    expect(gone.paused).toBe(false);

    // Well past the point where a card that is still on the board would have said so.
    budget.claim("here", here, 100, REVIEW_MS * 10);

    expect(budget.playing()).toEqual(["here"]);
    expect(gone.paused).toBe(true);
  });

  it("weighs the claims on a timer, not on every frame a card asks", () => {
    const budget = new PlaybackBudget(1);
    const first = new FakeClip();
    const second = new FakeClip();

    budget.claim("first", first, 100, 0);
    budget.claim("second", second, 900, 0);
    // Both claims land inside one window, so the first review sees both of them
    // and there is no frame where the smaller one was started and stopped again.
    budget.claim("second", second, 900, later(0));

    expect(first.plays).toBe(0);
    expect(second.paused).toBe(false);
  });
});

/**
 * The allowance is measured rather than chosen, so these drive it with frame
 * times: `ms` per frame for `count` frames, with the claims renewed throughout so
 * the budget has something waiting for the room it is being offered.
 */
function run(
  budget: PlaybackBudget,
  clips: Record<string, Playable>,
  options: { ms: number; count: number; from: number },
): number {
  let now = options.from;
  for (let frame = 0; frame < options.count; frame += 1) {
    now += options.ms;
    budget.frame(now);
    for (const [id, clip] of Object.entries(clips)) budget.claim(id, clip, 900, now);
  }
  return now;
}

describe("what the board can afford", () => {
  const smooth = { ms: 16, count: 400, from: 0 };
  const struggling = { ms: 40, count: 400, from: 0 };

  it("starts at a number it has not measured yet", () => {
    expect(new PlaybackBudget().allowance).toBe(START_PLAYING);
  });

  it("adds a clip at a time while the board keeps up", () => {
    const budget = new PlaybackBudget();
    const clips = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`clip-${index}`, new FakeClip()]),
    );

    run(budget, clips, smooth);

    expect(budget.allowance).toBeGreaterThan(START_PLAYING);
    expect(budget.playing()).toHaveLength(budget.allowance);
  });

  it("gives one up at a time while the board is behind", () => {
    const budget = new PlaybackBudget();
    const clips = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`clip-${index}`, new FakeClip()]),
    );

    run(budget, clips, struggling);

    expect(budget.allowance).toBeLessThan(START_PLAYING);
    expect(budget.allowance).toBeGreaterThanOrEqual(MIN_PLAYING);
  });

  it("never takes the last clip away, however slow the board is", () => {
    const budget = new PlaybackBudget();
    const clip = new FakeClip();

    run(budget, { only: clip }, { ms: 90, count: 600, from: 0 });

    expect(budget.allowance).toBe(MIN_PLAYING);
    expect(clip.paused).toBe(false);
  });

  it("does not raise the allowance past what the board is asking for", () => {
    const budget = new PlaybackBudget();
    const clip = new FakeClip();

    // One clip, a fast board: there is nothing to spend the room on, so it is not
    // taken. What a card wants is the point, not how high the number can get.
    run(budget, { only: clip }, smooth);

    expect(budget.allowance).toBe(START_PLAYING);
  });

  it("ignores a frame that was the tab being in the background", () => {
    const budget = new PlaybackBudget();
    const clips = { a: new FakeClip(), b: new FakeClip(), c: new FakeClip(), d: new FakeClip() };

    let now = run(budget, clips, { ms: 16, count: 200, from: 0 });
    const before = budget.allowance;
    // A second of nothing, then straight back to a smooth board.
    now += 1000;
    budget.frame(now);
    run(budget, clips, { ms: 16, count: 200, from: now });

    expect(budget.allowance).toBeGreaterThanOrEqual(before);
  });
});
