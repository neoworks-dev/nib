import { describe, expect, it } from "bun:test";
import { CHECKBOX_GAP, CHECKBOX_SIZE, STICKY_TYPE, stickyLines } from "../src/sticky-page";
import { STICKY_COLORS, STICKY_DEFAULT_COLOR, stickyColor, stickyTilt } from "../src/theme";

describe("stickyLines", () => {
  it("drops blank lines but keeps the file's own numbering, so a tick lands right", () => {
    const lines = stickyLines("- [ ] first\n\n- [x] second");

    expect(lines.map((line) => line.line)).toEqual([0, 2]);
    expect(lines.map((line) => line.gutter)).toEqual([
      { kind: "task", done: false },
      { kind: "task", done: true },
    ]);
  });

  it("draws a heading at the heading's own size rather than as body text", () => {
    const [heading, body] = stickyLines("## Snapping\nitems snap");

    expect(heading?.run.size).toBe(STICKY_TYPE.headline);
    expect(heading?.run.weight).toBe(700);
    expect(body?.run.size).toBe(STICKY_TYPE.body);
    expect(heading?.gutter).toBeNull();
  });

  it("indents a list past its own gutter and leaves prose flush", () => {
    const [bullet, numbered, prose] = stickyLines("- one\n2. two\nplain");

    expect(bullet?.indent).toBe(CHECKBOX_SIZE + CHECKBOX_GAP);
    expect(numbered?.gutter).toEqual({ kind: "number", label: "2." });
    expect(prose?.indent).toBe(0);
  });

  it("carries emphasis into the segments the card bakes, with the markers gone", () => {
    const [line] = stickyLines("plain **bold** ~~gone~~");

    expect(line?.run.text).toBe("plain bold gone");
    expect(line?.run.segments).toEqual([
      { text: "plain " },
      { weight: 700, text: "bold" },
      { text: " " },
      { strike: true, text: "gone" },
    ]);
  });

  it("holds the space a blank line makes, and closes up lines with none", () => {
    const [, tight] = stickyLines("intro\n- one");
    const [, spaced] = stickyLines("intro\n\n- one");
    const [, wider] = stickyLines("intro\n\n\n- one");

    expect(tight?.gapBefore).toBe(0);
    expect(spaced?.gapBefore).toBeGreaterThan(0);
    expect(wider?.gapBefore).toBe((spaced?.gapBefore ?? 0) * 2);
  });

  it("never opens the card with a gap, however the note starts", () => {
    const [first] = stickyLines("\n\nintro");

    expect(first?.gapBefore).toBe(0);
  });

  it("sets code in the mono face and points a link at its target", () => {
    const [code] = stickyLines("call `sessionId` first");
    const [link] = stickyLines("see [[event-log|the log]]");

    expect(code?.run.segments?.[1]?.family).toContain("mono");
    expect(link?.run.segments?.[1]).toMatchObject({ text: "the log", link: "event-log" });
  });
});

describe("stickyColor", () => {
  it("falls back to the default for a note that names nothing, or nonsense", () => {
    expect(stickyColor(null)).toBe(STICKY_DEFAULT_COLOR);
    expect(stickyColor("")).toBe(STICKY_DEFAULT_COLOR);
    expect(stickyColor("chartreuse")).toBe(STICKY_DEFAULT_COLOR);
  });

  it("reads a colour however it was cased or spaced", () => {
    expect(stickyColor(" Violet ")).toBe("violet");
    expect(stickyColor("RED")).toBe("red");
  });

  it("answers with a colour the palette can draw", () => {
    for (const name of Object.keys(STICKY_COLORS)) {
      expect(STICKY_COLORS[stickyColor(name)]).toBeDefined();
    }
  });
});

describe("stickyTilt", () => {
  const FIVE_DEGREES = (5 * Math.PI) / 180;

  it("turns every note, by no more than five degrees either way", () => {
    for (let index = 0; index < 200; index += 1) {
      const tilt = stickyTilt(`notes/untitled-${index}.md`);
      expect(Math.abs(tilt)).toBeLessThanOrEqual(FIVE_DEGREES);
      expect(Math.abs(tilt)).toBeGreaterThan(0);
    }
  });

  it("turns both ways", () => {
    const angles = Array.from({ length: 40 }, (_, index) => stickyTilt(`note-${index}.md`));

    expect(angles.some((angle) => angle < 0)).toBe(true);
    expect(angles.some((angle) => angle > 0)).toBe(true);
  });

  it("is the note's own angle, so it does not move on a reload", () => {
    expect(stickyTilt("a/b.md")).toBe(stickyTilt("a/b.md"));
    expect(stickyTilt("a/b.md")).not.toBe(stickyTilt("a/c.md"));
  });
});
