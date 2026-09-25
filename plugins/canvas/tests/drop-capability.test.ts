/**
 * Which cards a drag is allowed to promise something to. The outline under a
 * dragged card is a promise that letting go there moves it, so only a kind that
 * says it takes drops gets one.
 */

import { describe, expect, it } from "bun:test";
import type { CanvasObjectRenderer } from "@nib-ui/ui-contracts";
import { isDropSource, isDropTarget } from "../src/engine/drop";

const plain = { container: {}, sync: (): void => {} } as unknown as CanvasObjectRenderer;

describe("drop capabilities", () => {
  it("sees a target only where a kind answers for one", () => {
    expect(isDropTarget(plain)).toBe(false);
    expect(isDropTarget(undefined)).toBe(false);
    expect(isDropTarget({ ...plain, acceptsDrop: () => true } as CanvasObjectRenderer)).toBe(true);
  });

  it("sees a source only where a kind can be shown going in", () => {
    expect(isDropSource(plain)).toBe(false);
    expect(isDropSource(undefined)).toBe(false);
    expect(
      isDropSource({
        ...plain,
        previewDrop: () => {},
        swallowInto: () => {},
      } as CanvasObjectRenderer),
    ).toBe(true);
  });
});
