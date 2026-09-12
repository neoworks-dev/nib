import { describe, expect, it } from "bun:test";
import { overlaps, toSnapshot, buildVaultIndex, type VaultSource } from "@nib-ui/vault";
import {
  type BoardView,
  boardView,
  type FolderObject,
  MIN_CARD_SIZE,
  linkSummary,
  previewObjects,
  STICKY_SIZE,
  type StickyObject,
} from "../src/board-view";

/** A vault listing: directories and files, in the shape the scan produces. */
function snapshot(files: Record<string, string>): ReturnType<typeof toSnapshot> {
  const bodies = new Map(Object.entries(files));
  const topics = new Set<string>();
  for (const path of bodies.keys()) {
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      topics.add(parts.slice(0, depth).join("/"));
    }
  }

  const entries = [
    ...[...topics].map((path) => ({ path, kind: "topic" as const })),
    ...[...bodies.keys()].map((path) => ({ path, kind: "file" as const })),
  ];
  const source: VaultSource = { entries, bodies };
  return toSnapshot(buildVaultIndex(source));
}

const noSlot = (): { x: number; y: number } => ({ x: 0, y: 0 });

/** A directory is drawn as a folder; the test vault's short bodies are stickies. */
function topicAt(view: BoardView, path: string): FolderObject {
  const object = view.objects.find((entry) => entry.path === path);
  if (object?.kind !== "folder") throw new Error(`no folder card at ${path}`);
  return object;
}

function fileAt(view: BoardView, path: string): StickyObject {
  const object = view.objects.find((entry) => entry.path === path);
  if (object?.kind !== "sticky") throw new Error(`no sticky card at ${path}`);
  return object;
}

describe("boardView", () => {
  it("shows a board's own directory and nothing deeper", () => {
    const view = boardView({
      vault: snapshot({ "a.md": "", "b.md": "", "topic-x/c.md": "", "topic-x/sub/d.md": "" }),
      placements: {},
      board: "",
    });

    expect(view.objects.map((object) => object.path)).toEqual(["a.md", "b.md", "topic-x"]);
  });

  it("shows a topic's contents on the topic's board", () => {
    const view = boardView({
      vault: snapshot({ "a.md": "", "topic-x/c.md": "", "topic-x/sub/d.md": "" }),
      placements: {},
      board: "topic-x",
    });

    expect(view.objects.map((object) => object.path)).toEqual(["topic-x/c.md", "topic-x/sub"]);
    expect(view.objects.find((object) => object.path === "topic-x/sub")?.kind).toBe("folder");
  });

  it("counts a topic's direct children", () => {
    const view = boardView({
      vault: snapshot({ "topic-x/a.md": "", "topic-x/b.md": "", "topic-x/sub/c.md": "" }),
      placements: {},
      board: "",
    });

    expect(topicAt(view, "topic-x").count).toBe(3);
  });

  it("carries a note's preview and truncation, and draws a picture as a visual", () => {
    const view = boardView({
      vault: snapshot({ "note.md": "hello", "shot.png": "" }),
      placements: {},
      board: "",
    });

    const note = fileAt(view, "note.md");
    expect(note.preview).toBe("hello");
    expect(note.truncated).toBe(false);

    // A picture is the card, so it carries no body at all.
    expect(view.objects.find((entry) => entry.path === "shot.png")).toMatchObject({
      kind: "visual",
      video: false,
    });
  });

  it("keeps a stored position", () => {
    const view = boardView({
      vault: snapshot({ "a.md": "" }),
      placements: { "a.md": { x: 40, y: 60, w: 200, h: 100, z: 3 } },
      board: "",
    });

    expect(view.objects[0]).toMatchObject({ x: 40, y: 60, w: 200, h: 100, z: 3 });
    expect(view.added).toEqual([]);
  });

  it("gives a new object a position and reports it", () => {
    const view = boardView({
      vault: snapshot({ "a.md": "" }),
      placements: {},
      board: "",
      slot: noSlot,
    });

    expect(view.added).toEqual(["a.md"]);
    expect(view.objects[0]).toMatchObject({ x: 0, y: 0, ...STICKY_SIZE });
    expect(view.placements["a.md"]).toMatchObject({ x: 0, y: 0 });
  });

  it("reports a position whose path is gone", () => {
    const view = boardView({
      vault: snapshot({ "a.md": "" }),
      placements: { "gone.md": { x: 0, y: 0, w: 1, h: 1, z: 1 } },
      board: "",
    });

    expect(view.removed).toEqual(["gone.md"]);
    expect(view.placements["gone.md"]).toBeUndefined();
  });

  it("shows something placed here from another directory", () => {
    const view = boardView({
      vault: snapshot({ "topic-x/a.md": "" }),
      placements: { "topic-x/a.md": { x: 10, y: 10, w: 200, h: 100, z: 1 } },
      board: "",
    });

    // The topic card is this board's own; its note is here because it was placed here.
    expect(view.objects.map((object) => object.path)).toEqual(["topic-x", "topic-x/a.md"]);
    expect(view.added).toEqual(["topic-x"]);
    expect(view.objects.find((object) => object.path === "topic-x/a.md")).toMatchObject({
      x: 10,
      y: 10,
    });
  });

  it("does not show a deeper item that was never placed here", () => {
    const view = boardView({
      vault: snapshot({ "topic-x/a.md": "" }),
      placements: {},
      board: "",
    });

    expect(view.objects.map((object) => object.path)).toEqual(["topic-x"]);
  });

  it("takes a per-item size, and never goes below the minimum", () => {
    const view = boardView({
      vault: snapshot({ "wide.png": "", "tiny.png": "" }),
      placements: {},
      board: "",
      slot: noSlot,
      size: (item) => (item.path === "wide.png" ? { w: 400, h: 300 } : { w: 1, h: 1 }),
    });

    const wide = view.objects.find((object) => object.path === "wide.png");
    expect(wide).toMatchObject({ w: 400, h: 300 });

    const tiny = view.objects.find((object) => object.path === "tiny.png");
    expect(tiny).toMatchObject(MIN_CARD_SIZE);
  });

  it("orders what it adds by path, so a scan is reproducible", () => {
    const view = boardView({
      vault: snapshot({ "c.md": "", "a.md": "", "b.md": "" }),
      placements: {},
      board: "",
      slot: noSlot,
    });
    expect(view.added).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("carries a position across a rename that declared an id", () => {
    const view = boardView({
      vault: snapshot({ "new.md": "---\nid: note-1\n---\n" }),
      placements: { "old.md": { x: 7, y: 8, w: 200, h: 100, z: 2, id: "note-1" } },
      board: "",
    });

    expect(view.carried).toEqual(["new.md"]);
    expect(view.objects[0]).toMatchObject({ x: 7, y: 8 });
  });
});

describe("previewObjects", () => {
  it("shows a topic's own contents, laid out by the app", () => {
    const objects = previewObjects(
      snapshot({ "topic-x/a.md": "", "topic-x/b.md": "" }),
      "topic-x",
      {
        origin: { x: 0, y: 0 },
      },
    );

    expect(objects.map((object) => object.path)).toEqual(["topic-x/a.md", "topic-x/b.md"]);
  });

  it("includes a subtopic, and nothing from outside the topic", () => {
    const objects = previewObjects(
      snapshot({ "outside.md": "", "topic-x/a.md": "", "topic-x/sub/deep.md": "" }),
      "topic-x",
      { origin: { x: 0, y: 0 } },
    );

    expect(objects.map((object) => object.path)).toEqual(["topic-x/a.md", "topic-x/sub"]);
  });

  it("starts the block at the origin and never overlaps itself", () => {
    const objects = previewObjects(
      snapshot({
        "topic-x/a.md": "",
        "topic-x/b.md": "",
        "topic-x/c.md": "",
        "topic-x/d.md": "",
        "topic-x/e.md": "",
      }),
      "topic-x",
      { origin: { x: 100, y: 50 }, maxWidth: 700 },
    );

    for (const object of objects) {
      expect(object.x).toBeGreaterThanOrEqual(100);
      expect(object.y).toBeGreaterThanOrEqual(50);
    }
    for (const [index, left] of objects.entries()) {
      for (const right of objects.slice(index + 1)) {
        expect(overlaps(left, right)).toBe(false);
      }
    }
  });

  it("sizes each card for what it is, and never overlaps two", () => {
    const objects = previewObjects(
      snapshot({ "topic-x/a.md": "", "topic-x/b.png": "" }),
      "topic-x",
      {
        origin: { x: 0, y: 0 },
        maxWidth: 400,
        // A picture and a note want different room, so the block asks per item.
        size: (item) => (item.path.endsWith(".png") ? { w: 240, h: 160 } : { w: 180, h: 90 }),
      },
    );

    const note = objects.find((object) => object.path === "topic-x/a.md");
    const picture = objects.find((object) => object.path === "topic-x/b.png");
    if (!note || !picture) throw new Error("expected two cards");

    expect(note).toMatchObject({ w: 180, h: 90 });
    expect(picture).toMatchObject({ w: 240, h: 160 });
    expect(overlaps(note, picture)).toBe(false);
  });

  it("is empty for a topic with nothing in it", () => {
    expect(previewObjects(snapshot({ "a.md": "" }), "topic-x", { origin: { x: 0, y: 0 } })).toEqual(
      [],
    );
  });
});

describe("linkSummary", () => {
  it("reports what an item points at, what points back, and what only says its name", () => {
    const vault = {
      ...snapshot({ "a.md": "[[b]] and [[nowhere]]", "b.md": "about a" }),
      mentions: [{ source: "b.md", target: "a.md", count: 1 }],
    };

    expect(linkSummary(vault, "a.md")).toEqual({
      path: "a.md",
      outgoing: [
        { target: "b", to: "b.md", ambiguous: false },
        { target: "nowhere", to: null, ambiguous: false },
      ],
      backlinks: [],
      suggestions: [],
      mentionedBy: [{ path: "b.md", count: 1 }],
    });

    expect(linkSummary(vault, "b.md")).toEqual({
      path: "b.md",
      outgoing: [],
      backlinks: ["a.md"],
      suggestions: [{ path: "a.md", count: 1 }],
      mentionedBy: [],
    });
  });
});
