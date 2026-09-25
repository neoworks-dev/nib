import { describe, expect, it } from "bun:test";
import { sheetRuns } from "../src/sheet-page";
import type { BoardTheme } from "../src/theme";

const theme: BoardTheme = {
  background: 0xe9eaee,
  card: 0xffffff,
  cardRaised: 0xf4f5f7,
  border: 0xe2e4e8,
  borderStrong: 0xc9cdd4,
  action: 0xffffff,
  text: "#16171a",
  muted: "#5f6570",
  dim: "#8a8f98",
  faint: "#b4b8bf",
  green: 0x1f9d55,
  red: 0xd64545,
  amber: 0xd99e2b,
  blue: 0x2f6fed,
  violet: 0x7b5bd6,
};

function texts(title: string | null, markdown: string): string[] {
  return sheetRuns(title, markdown, theme).map((run) => run.text);
}

describe("sheetRuns", () => {
  it("draws the markdown rather than its source", () => {
    const runs = sheetRuns(null, "## Framing\n\nOne square tile.", theme);

    expect(runs.map((run) => run.text)).toEqual(["Framing", "One square tile."]);
    // The heading is the larger of the two, which is what makes it a heading.
    expect(runs[0]?.size).toBeGreaterThan(runs[1]?.size ?? 0);
    expect(runs[0]?.weight).toBe(700);
  });

  it("leaves the title out where the document opens with one of its own", () => {
    expect(texts("Terrain tile render", "# Terrain tile render\n\nprose")).toEqual([
      "Terrain tile render",
      "prose",
    ]);
  });

  it("draws the title where the document has no heading to open with", () => {
    expect(texts("Terrain tile render", "prose")).toEqual(["Terrain tile render", "prose"]);
  });

  it("gives an untitled document no title line at all", () => {
    expect(texts(null, "prose")).toEqual(["prose"]);
  });

  it("joins a hard-wrapped paragraph, and keeps a blank line as a break", () => {
    expect(texts(null, "one line\nwrapped on\n\nsecond para")).toEqual([
      "one line wrapped on",
      "second para",
    ]);
  });

  it("marks a list and a task, and dims a task that is done", () => {
    const runs = sheetRuns(null, "- a point\n- [ ] open\n- [x] closed", theme);

    expect(runs.map((run) => run.text)).toEqual(["•  a point", "☐  open", "☑  closed"]);
    expect(runs[2]?.color).toBe(theme.faint);
    expect(runs[1]?.color).toBe(theme.muted);
  });
});

describe("tables", () => {
  const markdown = "Before.\n\n| Name | Age |\n| --- | ---: |\n| Ada | 36 |\n\nAfter.";

  it("draws the table as one preformatted run rather than as prose", () => {
    const runs = sheetRuns(null, markdown, theme);
    const table = runs.find((run) => run.pre === true);
    expect(table?.text.split("\n")).toEqual(["Name  Age", "────  ───", "Ada    36"]);
  });

  it("keeps the prose around it out of the table", () => {
    expect(texts(null, markdown)).toEqual(["Before.", "Name  Age\n────  ───\nAda    36", "After."]);
  });
});
