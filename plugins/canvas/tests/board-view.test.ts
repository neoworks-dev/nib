import { describe, expect, it } from "bun:test";
import {
  overlaps,
  toSnapshot,
  buildVaultIndex,
  type Size,
  type VaultSnapshotItem,
  type VaultSource,
} from "@nib-ui/vault";
import { cardKindFor } from "../src/card-kind";
import { folderSheets } from "../src/folder-sheets";
import {
  type BoardView,
  boardView,
  FILE_SIZE,
  FOLDER_SIZE,
  type FolderObject,
  MIN_CARD_SIZE,
  linkSummary,
  pictureCardSize,
  PREVIEW_COLUMNS,
  PREVIEW_GAP,
  previewObjects,
  pushAside,
  SHEET_SIZE,
  STICKY_SIZE,
  type StickyObject,
  VISUAL_SIZE,
  WEBCLIP_SIZE,
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

/** Long enough to be drawn as a page rather than as a note. */
const longNote = Array.from({ length: 40 }, (_, line) => `line ${line}`).join("\n");

/** What the app itself does: one size per kind, so a band is a clean row. */
function sizeByKind(item: VaultSnapshotItem): Size {
  switch (cardKindFor(item)) {
    case "folder":
      return FOLDER_SIZE;
    case "sheet":
      return SHEET_SIZE;
    case "visual":
      return VISUAL_SIZE;
    case "webclip":
      return WEBCLIP_SIZE;
    case "sticky":
      return STICKY_SIZE;
    case "file":
      return FILE_SIZE;
  }
}

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

  it("names a note by its opening heading, and does not draw that heading twice", () => {
    const view = boardView({
      vault: snapshot({ "note.md": "# The vault\n\nA project is a directory." }),
      placements: {},
      board: "",
    });

    const note = fileAt(view, "note.md");
    expect(note.title).toBe("The vault");
    expect(note.preview).toBe("A project is a directory.");
  });

  it("lets a frontmatter title win, and leaves the body it did not come from alone", () => {
    const view = boardView({
      vault: snapshot({ "note.md": "---\ntitle: The vault\n---\n\n# Heading\n\nprose" }),
      placements: {},
      board: "",
    });

    const note = fileAt(view, "note.md");
    expect(note.title).toBe("The vault");
    expect(note.preview).toContain("# Heading");
  });

  it("draws a transcript as a chat, carrying the session it is of", () => {
    const view = boardView({
      vault: snapshot({ "33c82344-5d75-4145-86de-e264d91555f3.jsonl": "" }),
      placements: {},
      board: "",
    });

    // The card holds the id and nothing else: what the chat says is the live
    // session's, so a card of a running one is never a stale copy of it.
    expect(view.objects[0]).toMatchObject({
      kind: "transcript",
      sessionId: "33c82344-5d75-4145-86de-e264d91555f3",
    });
  });

  it("leaves an omitted item off the board and drops the position it had", () => {
    const parent = "33c82344-5d75-4145-86de-e264d91555f3.jsonl";
    const child = "7d3d5a1c-9f0e-4b1e-8d2a-1b2c3d4e5f60.jsonl";
    const view = boardView({
      vault: snapshot({ [parent]: "", [child]: "" }),
      placements: { [child]: { x: 10, y: 10, w: 100, h: 100, z: 1 } },
      board: "",
      omit: (item) => item.path === child,
    });

    expect(view.objects.map((object) => object.path)).toEqual([parent]);
    expect(view.removed).toEqual([child]);
    expect(Object.keys(view.placements)).toEqual([parent]);
  });

  it("tells a folder what it holds, so its card can show it", () => {
    const view = boardView({
      vault: snapshot({
        "topic-x/a.md": "one line",
        "topic-x/b.md": longNote,
        "topic-x/c.md": "one line",
      }),
      placements: {},
      board: "",
    });

    const folder = topicAt(view, "topic-x");
    expect(folder.count).toBe(3);
    // A paper per item, each the file it is, so the card draws what is inside
    // rather than a stand-in for it — and in the order the folder opens into, so
    // the card that comes out of a sheet is the one that was drawn on it.
    expect(folder.peek).toEqual([
      { path: "topic-x/b.md", kind: "sheet", label: "b" },
      { path: "topic-x/a.md", kind: "sticky", label: "a" },
      { path: "topic-x/c.md", kind: "sticky", label: "c" },
    ]);
  });

  it("lets every kind stand out of a folder, not the pictures alone", () => {
    const view = boardView({
      vault: snapshot({
        "topic-x/a.md": "one line",
        "topic-x/b.png": "",
        "topic-x/c.md": longNote,
      }),
      placements: {},
      board: "",
    });

    const folder = topicAt(view, "topic-x");
    expect(folder.count).toBe(3);
    expect(folder.peek.map((item) => item.path)).toEqual([
      "topic-x/b.png",
      "topic-x/c.md",
      "topic-x/a.md",
    ]);
  });

  it("gives every item inside a sheet of its own, however many there are", () => {
    const files = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`topic-x/${index}.md`, "one"]),
    );
    const view = boardView({ vault: snapshot(files), placements: {}, board: "" });

    // What comes out of the folder comes out of a sheet, so a folder that drew
    // four of forty could only have thirty-six cards appear from nowhere.
    const folder = topicAt(view, "topic-x");
    expect(folder.count).toBe(40);
    expect(folder.peek).toHaveLength(40);
  });

  it("gives every peeked item the line it opens with", () => {
    const view = boardView({
      vault: snapshot({ "topic-x/sub/a.md": "# Alpha\n\nbody" }),
      placements: {},
      board: "topic-x",
    });

    expect(topicAt(view, "topic-x/sub").peek).toEqual([
      { path: "topic-x/sub/a.md", kind: "sticky", label: "Alpha" },
    ]);
  });

  it("falls back to a file's own name where it says no title", () => {
    const view = boardView({
      vault: snapshot({ "topic-x/sub/a.md": "" }),
      placements: {},
      board: "topic-x",
    });

    expect(topicAt(view, "topic-x/sub").peek).toEqual([
      { path: "topic-x/sub/a.md", kind: "sticky", label: "a" },
    ]);
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

    // The topic card is this board's own; its note is here because it was placed
    // here. Objects come back in `z` order, and a card that has just been given a
    // position lands on top of the ones that already had one.
    expect(view.objects.map((object) => object.path)).toEqual(["topic-x/a.md", "topic-x"]);
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

  it("has every card come out of its own sheet, and only when asked", () => {
    const vault = snapshot({ "topic-x/a.md": "", "topic-x/b.md": "" });
    const from = { x: 40, y: 60, ...FOLDER_SIZE };
    const out = previewObjects(vault, "topic-x", { origin: { x: 400, y: 60 }, from });

    // The sheets the folder's own card draws, in the folder's own place: each
    // card starts as the sheet it was drawn on and goes back into it.
    const sheets = folderSheets(out.length, FOLDER_SIZE.w, FOLDER_SIZE.h);
    expect(out.map((object) => object.from)).toEqual(
      sheets.map((sheet) => ({ ...sheet, x: from.x + sheet.x, y: from.y + sheet.y })),
    );
    // A sheet each, and no two in the same place: what leaves is what was there.
    expect(new Set(out.map((object) => object.from?.y)).size).toBe(out.length);

    // Without one the card is simply already where it belongs, and a renderer
    // that tweened anyway would fly it in from the world origin.
    const plain = previewObjects(vault, "topic-x", { origin: { x: 400, y: 60 } });
    for (const object of plain) expect(object.from).toBeUndefined();
  });

  it("includes a subtopic, and nothing from outside the topic", () => {
    const objects = previewObjects(
      snapshot({ "outside.md": "", "topic-x/a.md": "", "topic-x/sub/deep.md": "" }),
      "topic-x",
      { origin: { x: 0, y: 0 } },
    );

    // Ordered by band, not by name: the subtopic is a folder and folders lead.
    expect(objects.map((object) => object.path)).toEqual(["topic-x/sub", "topic-x/a.md"]);
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

  it("groups the contents into bands by kind, in the band order", () => {
    // Written out of name order on purpose: the block is composed by what things
    // are, so a picture named `z` still sits above a note named `a`.
    const objects = previewObjects(
      snapshot({
        "topic-x/z-note.md": longNote,
        "topic-x/a-shot.png": "",
        "topic-x/m-todo.md": "one line",
        "topic-x/sub/deep.md": "",
      }),
      "topic-x",
      { origin: { x: 0, y: 0 }, size: sizeByKind },
    );

    expect(objects.map((object) => object.kind)).toEqual(["folder", "visual", "sheet", "sticky"]);
    for (const [index, left] of objects.entries()) {
      for (const right of objects.slice(index + 1)) {
        expect(overlaps(left, right)).toBe(false);
      }
    }
  });

  it("packs the block rather than giving each kind a row of its own", () => {
    // Two pictures and a note: a picture is 230 tall and a note 300, so a row per
    // kind would put the note 230 + a gap down with nothing beside the pictures.
    const objects = previewObjects(
      snapshot({ "topic-x/a.png": "", "topic-x/b.png": "", "topic-x/c.md": "one line" }),
      "topic-x",
      { origin: { x: 0, y: 0 }, maxWidth: 740, size: sizeByKind },
    );

    const note = objects.find((object) => object.kind === "sticky");
    // Under the picture it fits beneath, not under the whole band of them.
    expect(note?.y).toBe(VISUAL_SIZE.h + PREVIEW_GAP);
    expect(note?.x).toBe(0);
  });

  it("lays a band out as a row, so cards of one kind share a top edge", () => {
    const objects = previewObjects(
      snapshot({ "topic-x/a.png": "", "topic-x/b.png": "", "topic-x/c.png": "" }),
      "topic-x",
      { origin: { x: 0, y: 0 }, maxWidth: 1200, size: sizeByKind },
    );

    expect(objects).toHaveLength(3);
    for (const object of objects) expect(object.y).toBe(0);
  });

  it("puts six cards side by side before a band wraps", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < PREVIEW_COLUMNS; index += 1) files[`topic-x/${index}.png`] = "";

    const objects = previewObjects(snapshot(files), "topic-x", {
      origin: { x: 0, y: 0 },
      size: sizeByKind,
    });

    expect(objects).toHaveLength(PREVIEW_COLUMNS);
    // One row: the default width is what decides this, so a folder opened with no
    // width of its own is the case under test.
    for (const object of objects) expect(object.y).toBe(0);
  });

  it("wraps the seventh card onto the next row rather than running off forever", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index <= PREVIEW_COLUMNS; index += 1) files[`topic-x/${index}.png`] = "";

    const objects = previewObjects(snapshot(files), "topic-x", {
      origin: { x: 0, y: 0 },
      size: sizeByKind,
    });

    expect(objects.filter((object) => object.y === 0)).toHaveLength(PREVIEW_COLUMNS);
    expect(objects.at(-1)?.y).toBeGreaterThan(0);
  });

  it("wraps a band of narrow cards at six too, not at whatever the block is wide", () => {
    const files: Record<string, string> = {};
    for (let index = 0; index <= PREVIEW_COLUMNS; index += 1) files[`topic-x/${index}.zip`] = "";

    const objects = previewObjects(snapshot(files), "topic-x", {
      origin: { x: 0, y: 0 },
      size: sizeByKind,
    });

    expect(objects.filter((object) => object.y === 0)).toHaveLength(PREVIEW_COLUMNS);
    const right = Math.max(...objects.map((object) => object.x + object.w));
    expect(right).toBeLessThanOrEqual(
      PREVIEW_COLUMNS * FILE_SIZE.w + (PREVIEW_COLUMNS - 1) * PREVIEW_GAP,
    );
  });

  it("does not leave a gap for a kind the topic holds none of", () => {
    // A topic of nothing but stickies starts at the origin, rather than below the
    // empty space where the pictures and pages would have been.
    const objects = previewObjects(
      snapshot({ "topic-x/a.md": "one line", "topic-x/b.md": "one line" }),
      "topic-x",
      { origin: { x: 0, y: 0 }, size: sizeByKind },
    );

    expect(objects.map((object) => object.kind)).toEqual(["sticky", "sticky"]);
    for (const object of objects) expect(object.y).toBe(0);
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

describe("pushAside", () => {
  /** The folder, and the block its contents landed in beside it: 0..200, 240..640. */
  const folder = { x: 0, y: 0, w: 200, h: 400 };
  const block = [{ x: 240, y: 0, w: 400, h: 400 }];
  const gap = 24;

  function shifts(
    placements: Record<string, { x: number; y: number; w: number; h: number }>,
    except: ReadonlySet<string> = new Set(),
  ): ReadonlyMap<string, number> {
    const vault = snapshot(Object.fromEntries(Object.keys(placements).map((path) => [path, ""])));
    const view = boardView({
      vault,
      placements: Object.fromEntries(
        Object.entries(placements).map(([path, rect]) => [path, { ...rect, z: 1 }]),
      ),
      board: "",
    });
    return pushAside(view.objects, folder, block, except, gap);
  }

  it("moves a card clear by the nearer edge of the folder and its contents together", () => {
    const pushed = shifts({
      "right.md": { x: 400, y: 0, w: 50, h: 50 },
      "left.md": { x: -100, y: 0, w: 150, h: 50 },
    });

    // Past the region's middle, so it leaves to the right: 640 + 24 - 400.
    expect(pushed.get("right.md")).toBe(264);
    // It has to clear 0 - 24, which is 74 — but the right gave up 264, so the
    // left's share of that is what actually moves it.
    expect(pushed.get("left.md")).toBe(-79);
  });

  it("gives way a little on the side the block never reaches", () => {
    const pushed = shifts({
      "covered.md": { x: 400, y: 0, w: 50, h: 50 },
      // Well clear of the folder: nothing it has to make room for.
      "left.md": { x: -400, y: 0, w: 50, h: 50 },
    });

    expect(pushed.get("covered.md")).toBe(264);
    // A board where only one side parts reads as a block landing on it, so the
    // left takes its share of what the right gave: 264 * 0.3.
    expect(pushed.get("left.md")).toBe(-79);
  });

  it("never pushes a card onto the folder that stayed put", () => {
    // Between the folder and the block, which is where clearing the block alone
    // used to land a card: straight on top of the opened folder.
    const pushed = shifts({ "between.md": { x: 210, y: 0, w: 50, h: 50 } });

    const shift = pushed.get("between.md");
    expect(shift).toBeDefined();
    expect(210 + (shift ?? 0) + 50).toBeLessThanOrEqual(folder.x - gap);
  });

  it("moves a whole side by one amount, so the parting opens no gap it closes", () => {
    const pushed = shifts({
      "near.md": { x: -100, y: 0, w: 150, h: 50 },
      "far.md": { x: -400, y: 0, w: 50, h: 50 },
    });

    // The worst-covered card decides, and the one behind it keeps its distance.
    expect(pushed.get("near.md")).toBe(-74);
    expect(pushed.get("far.md")).toBe(-74);
  });

  it("leaves everything the block never reaches where it is", () => {
    const pushed = shifts({
      "below.md": { x: 300, y: 500, w: 50, h: 50 },
      "above.md": { x: 300, y: -100, w: 50, h: 50 },
      // In the band, but already clear on its side and nothing pushing it.
      "beside.md": { x: 700, y: 0, w: 50, h: 50 },
    });

    expect(pushed.size).toBe(0);
  });

  it("leaves what came out of the thing alone, and pushes nothing for an empty one", () => {
    const vault = snapshot({ "a.md": "", "right.md": "" });
    const view = boardView({
      vault,
      placements: {
        "a.md": { x: 300, y: 0, w: 50, h: 50, z: 1 },
        "right.md": { x: 300, y: 0, w: 50, h: 50, z: 1 },
      },
      board: "",
    });

    expect(pushAside(view.objects, folder, block, new Set(["a.md"]), gap).has("a.md")).toBe(false);
    expect(pushAside(view.objects, folder, [], new Set(), gap).size).toBe(0);
  });
});

describe("pictureCardSize", () => {
  it("keeps a wide picture's shape, as wide as the default visual card", () => {
    expect(pictureCardSize({ width: 800, height: 400 })).toEqual({ w: VISUAL_SIZE.w, h: 170 });
  });

  it("keeps a tall picture's shape, its height the default card's width", () => {
    expect(pictureCardSize({ width: 300, height: 600 })).toEqual({ w: 170, h: VISUAL_SIZE.w });
  });

  it("falls back to the default card for a picture with no size", () => {
    expect(pictureCardSize({ width: 0, height: 0 })).toEqual(VISUAL_SIZE);
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
