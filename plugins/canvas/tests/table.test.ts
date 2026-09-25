import { describe, expect, it } from "bun:test";
import { parseTable, tableLines, tableMarkdown, tableRegions } from "../src/table";

const TABLE = ["| Name | Age |", "| --- | ---: |", "| Ada | 36 |", "| Grace | 45 |"].join("\n");

describe("parseTable", () => {
  it("reads the header, the alignment and the rows", () => {
    const table = parseTable(TABLE);
    expect(table).toEqual({
      header: ["Name", "Age"],
      align: ["left", "right"],
      rows: [
        ["Ada", "36"],
        ["Grace", "45"],
      ],
    });
  });

  it("reads a table written without outer pipes", () => {
    expect(parseTable("a | b\n--- | ---\n1 | 2")?.header).toEqual(["a", "b"]);
  });

  it("squares short and long rows off against the header", () => {
    const table = parseTable("| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |");
    expect(table?.rows).toEqual([
      ["1", ""],
      ["1", "2"],
    ]);
  });

  it("keeps an escaped pipe inside the cell it was written in", () => {
    expect(parseTable("| a | b |\n| --- | --- |\n| x \\| y | z |")?.rows).toEqual([["x | y", "z"]]);
  });

  it("is not a table without a delimiter row", () => {
    expect(parseTable("| a | b |\n| c | d |")).toBeNull();
  });

  it("is not a table when the delimiter row is a different width", () => {
    expect(parseTable("| a | b |\n| --- |\n| 1 | 2 |")).toBeNull();
  });

  it("is not a table for a line of dashes under a sentence", () => {
    expect(parseTable("Heading\n---")).toBeNull();
  });
});

describe("tableRegions", () => {
  it("finds every table and the lines it occupies", () => {
    const document = `intro\n\n${TABLE}\n\nbetween\n\n| x |\n| --- |\n| 1 |\n`;
    expect(tableRegions(document).map((region) => [region.firstLine, region.lastLine])).toEqual([
      [2, 5],
      [9, 11],
    ]);
  });

  it("finds nothing in prose", () => {
    expect(tableRegions("no tables here\njust words")).toEqual([]);
  });
});

describe("tableLines", () => {
  it("pads the columns so a monospaced card draws a grid", () => {
    const table = parseTable(TABLE);
    expect(table && tableLines(table)).toEqual([
      "Name   Age",
      "─────  ───",
      "Ada     36",
      "Grace   45",
    ]);
  });
});

describe("tableMarkdown", () => {
  it("round-trips a table through the grid", () => {
    const table = parseTable(TABLE);
    expect(table && parseTable(tableMarkdown(table))).toEqual(table);
  });

  it("keeps the alignment markers", () => {
    const table = parseTable("| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |");
    expect(table && tableMarkdown(table).split("\n")[1]).toBe("| --- | :-: | --: |");
  });

  it("escapes a pipe typed into a cell", () => {
    const written = tableMarkdown({
      header: ["a"],
      align: ["left"],
      rows: [["x | y"]],
    });
    expect(parseTable(written)?.rows).toEqual([["x | y"]]);
  });

  it("puts a newline pasted into a cell back on one line", () => {
    const written = tableMarkdown({ header: ["a"], align: ["left"], rows: [["one\ntwo"]] });
    expect(written.split("\n")).toHaveLength(3);
    expect(parseTable(written)?.rows).toEqual([["one two"]]);
  });
});
