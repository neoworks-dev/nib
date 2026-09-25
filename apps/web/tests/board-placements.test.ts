import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Placement } from "@nib-ui/vault";
import {
  applyPlacements,
  parseBoard,
  readBoardFile,
  writeBoardFile,
} from "../src/lib/server/board-store";

const cwd = "/home/dev/repo";

let directory = "";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "nib-placements-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function placement(x: number, y: number, z = 1): Placement {
  return { x, y, w: 200, h: 120, z };
}

describe("placements in the board document", () => {
  it("reads an empty map out of a document that has none", () => {
    expect(parseBoard({ version: 1, rev: 2, cwd }, cwd).placements).toEqual({});
  });

  it("drops an entry that could not be drawn", () => {
    const raw = {
      placements: {
        "": {
          "a.md": { x: 1, y: 2, w: 3, h: 4, z: 5 },
          "bad.md": { x: 1 },
        },
      },
    };
    expect(parseBoard(raw, cwd).placements).toEqual({
      "": { "a.md": { x: 1, y: 2, w: 3, h: 4, z: 5 } },
    });
  });

  it("round-trips a written map", async () => {
    await writeBoardFile(directory, {
      version: 1,
      rev: 1,
      cwd,
      objects: [],
      placements: { "": { "a.md": placement(10, 20) } },
    });

    const read = await readBoardFile(directory, cwd);
    expect(read.placements).toEqual({ "": { "a.md": placement(10, 20) } });
  });

  it("keeps the stored map when a window sends none", async () => {
    const stored = { "": { "a.md": placement(10, 20) } };
    await writeBoardFile(directory, {
      version: 1,
      rev: 1,
      cwd,
      objects: [],
      placements: stored,
    });
    // A build that predates the vault sends a document with no `placements` at all.
    await writeBoardFile(directory, { version: 1, rev: 2, cwd, objects: [] });

    const read = await readBoardFile(directory, cwd);
    expect(read.rev).toBe(2);
    expect(read.placements).toEqual(stored);
  });

  it("takes a map a window does send, including an empty one", async () => {
    await writeBoardFile(directory, {
      version: 1,
      rev: 1,
      cwd,
      objects: [],
      placements: { "": { "a.md": placement(10, 20) } },
    });
    await writeBoardFile(directory, {
      version: 1,
      rev: 2,
      cwd,
      objects: [],
      placements: {},
    });

    expect((await readBoardFile(directory, cwd)).placements).toEqual({});
  });

  it("keeps placements out of the workstream summary", () => {
    const raw = { placements: { "": { "a.md": placement(1, 1) } } };
    expect(parseBoard(raw, cwd).placements[""]?.["a.md"]?.x).toBe(1);
  });
});

describe("applyPlacements", () => {
  it("files each path under the board of its own directory", () => {
    const map = applyPlacements({}, [
      { path: "a.md", x: 0, y: 0, w: 200, h: 120 },
      { path: "topic/b.md", x: 40, y: 40, w: 200, h: 120 },
    ]);
    expect(map).toEqual({
      "": { "a.md": { x: 0, y: 0, w: 200, h: 120, z: 1 } },
      topic: { "topic/b.md": { x: 40, y: 40, w: 200, h: 120, z: 1 } },
    });
  });

  it("moves a placed card without touching its size, depth or id", () => {
    const stored = { "": { "a.md": { x: 0, y: 0, w: 200, h: 120, z: 7, id: "keep" } } };
    expect(applyPlacements(stored, [{ path: "a.md", x: 90, y: 30 }])).toEqual({
      "": { "a.md": { x: 90, y: 30, w: 200, h: 120, z: 7, id: "keep" } },
    });
  });

  it("resizes only when a size is asked for, and stacks the new card on top", () => {
    const stored = { "": { "a.md": placement(0, 0, 4) } };
    const map = applyPlacements(stored, [
      { path: "a.md", x: 0, y: 0, w: 300, h: 300 },
      { path: "b.md", x: 320, y: 0 },
    ]);
    expect(map[""]?.["a.md"]).toEqual({ x: 0, y: 0, w: 300, h: 300, z: 4 });
    expect(map[""]?.["b.md"]).toEqual({ x: 320, y: 0, w: 256, h: 300, z: 5 });
  });

  it("takes a moved card out of the pile it was folded into", () => {
    const stored = { "": { "a.md": { ...placement(0, 0), stack: "pile" } } };
    expect(applyPlacements(stored, [{ path: "a.md", x: 10, y: 10 }])[""]?.["a.md"]).toEqual({
      x: 10,
      y: 10,
      w: 200,
      h: 120,
      z: 1,
    });
  });

  it("leaves the map it was given alone", () => {
    const stored = { "": { "a.md": placement(0, 0) } };
    applyPlacements(stored, [{ path: "a.md", x: 99, y: 99 }]);
    expect(stored[""]["a.md"]).toEqual(placement(0, 0));
  });
});
