/**
 * Leaving the board is cancelable. A folder closed and re-opened before its
 * contents have got back inside has to take the same cards back: an exit that
 * finished anyway would remove a card the board is drawing again, and one that
 * kept animating would drag it back into the folder it just came out of.
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Container, Ticker } from "pixi.js";
import { ObjectRenderer } from "../src/engine/ObjectRenderer";

const wasAutoStart = Ticker.shared.autoStart;

/** Long enough for any exit in the plugin to have run to its end. */
const PAST_EVERY_EXIT_MS = 400;

class TestRenderer extends ObjectRenderer {
  readonly container = new Container();
  sync(): void {}
}

function run(): void {
  Ticker.shared.update(performance.now());
}

beforeEach(() => {
  Ticker.shared.autoStart = false;
  Ticker.shared.stop();
});

afterAll(() => {
  Ticker.shared.autoStart = wasAutoStart;
});

describe("exit", () => {
  it("removes the object once it has animated out", async () => {
    const renderer = new TestRenderer();
    let removed = 0;
    renderer.exit(() => {
      removed += 1;
    });

    run();
    expect(removed).toBe(0);
    await Bun.sleep(PAST_EVERY_EXIT_MS);
    run();
    expect(removed).toBe(1);
  });

  it("never removes an object that came back", async () => {
    const renderer = new TestRenderer();
    renderer.container.eventMode = "static";
    let removed = 0;
    renderer.exit(() => {
      removed += 1;
    });
    run();

    renderer.cancelExit();
    // Whole again, and able to be clicked: it is on the board, not on its way off.
    expect(renderer.container.alpha).toBe(1);
    expect(renderer.container.scale.x).toBe(1);
    expect(renderer.container.eventMode).toBe("static");

    await Bun.sleep(PAST_EVERY_EXIT_MS);
    run();
    expect(removed).toBe(0);
  });

  it("takes an object that left and came back out again", async () => {
    const renderer = new TestRenderer();
    let removed = 0;
    renderer.exit(() => {
      removed += 1;
    });
    run();
    renderer.cancelExit();

    renderer.exit(() => {
      removed += 1;
    });
    await Bun.sleep(PAST_EVERY_EXIT_MS);
    run();
    // The second exit alone: the one that was called off stayed off.
    expect(removed).toBe(1);
  });

  it("ignores a second exit while one is running", async () => {
    const renderer = new TestRenderer();
    let removed = 0;
    renderer.exit(() => {
      removed += 1;
    });
    renderer.exit(() => {
      removed += 1;
    });

    await Bun.sleep(PAST_EVERY_EXIT_MS);
    run();
    expect(removed).toBe(1);
  });
});
