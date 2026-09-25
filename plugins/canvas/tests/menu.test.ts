import { describe, expect, test } from "bun:test";
import type { CanvasObject } from "@nib-ui/ui-contracts";
import type { Component } from "svelte";
import {
  backdropMenuItems,
  type BoardMenu,
  type BoardMenuIcons,
  boardMenuItems,
  menuTargets,
} from "../src/menu";

const at = { x: 10, y: 20 };

/** The menu only passes icons through, so one stand-in serves every entry. */
const icon = (() => {}) as unknown as Component<{ size?: number }>;
const icons: BoardMenuIcons = {
  dissolve: icon,
  collapse: icon,
  arrange: icon,
  join: icon,
  group: icon,
  preview: icon,
  enter: icon,
  open: icon,
  start: icon,
  unlink: icon,
  trash: icon,
  note: icon,
  paste: icon,
};

function object(id: string, kind: string): CanvasObject {
  return { id, kind, x: 0, y: 0 };
}

interface Calls {
  paint: [string[], string][];
  erase: string[][];
  remove: string[][];
  unlink: string[][];
  startWorkstream: string[][];
  grouped: string[][];
  dissolved: string[];
  collapsed: number;
  arranged: number;
  joined: number;
}

function board(overrides: Partial<BoardMenu> = {}): { menu: BoardMenu; calls: Calls } {
  const calls: Calls = {
    paint: [],
    erase: [],
    remove: [],
    unlink: [],
    startWorkstream: [],
    grouped: [],
    dissolved: [],
    collapsed: 0,
    arranged: 0,
    joined: 0,
  };
  const menu: BoardMenu = {
    selection: [],
    objects: [],
    icons,
    stackOf: () => null,
    canUnlink: () => false,
    carries: () => false,
    actions: {
      dissolveStack: (stack) => calls.dissolved.push(stack),
      collapse: () => {
        calls.collapsed += 1;
      },
      arrange: () => {
        calls.arranged += 1;
      },
      join: () => {
        calls.joined += 1;
      },
      group: (grouped) => calls.grouped.push(grouped),
      paint: (ids, color) => calls.paint.push([ids, color]),
      preview: () => {},
      enter: () => {},
      open: () => {},
      startWorkstream: (ids) => calls.startWorkstream.push(ids),
      unlink: (ids) => calls.unlink.push(ids),
      erase: (ids) => calls.erase.push(ids),
      remove: (ids) => calls.remove.push(ids),
    },
    ...overrides,
  };
  return { menu, calls };
}

function ids(items: ReturnType<typeof boardMenuItems>): string[] {
  return items.map((item) => item.id);
}

function run(items: ReturnType<typeof boardMenuItems>, id: string): void {
  const item = items.find((entry) => entry.id === id);
  if (item?.kind !== "action") throw new Error(`no action ${id} in the menu`);
  void item.run();
}

describe("menuTargets", () => {
  const card = object("a", "sticky");

  test("a card inside the selection acts on the whole of it", () => {
    expect(menuTargets(card, ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("a card outside it acts on itself alone", () => {
    expect(menuTargets(card, ["b", "c"])).toEqual(["a"]);
    expect(menuTargets(card, ["a"])).toEqual(["a"]);
    expect(menuTargets(card, [])).toEqual(["a"]);
  });
});

describe("boardMenuItems", () => {
  test("a single file offers no group actions", () => {
    const { menu } = board({ objects: [object("a", "file")], selection: ["a"] });
    const items = boardMenuItems(object("a", "file"), at, menu);

    // No separator: nothing precedes the delete, so there is nothing to divide.
    expect(ids(items)).toEqual(["canvas.vault.delete"]);
    expect(items.find((item) => item.id === "canvas.vault.delete")).toMatchObject({
      label: "Delete this file",
      danger: true,
    });
  });

  test("a group offers what the docked bar used to, acting on all of it", () => {
    const card = object("a", "file");
    const objects = [card, object("b", "file"), object("c", "file")];
    const { menu, calls } = board({ objects, selection: ["a", "b", "c"] });
    const items = boardMenuItems(card, at, menu);

    expect(ids(items)).toEqual([
      "canvas.stack.collapse",
      "canvas.arrange.grid",
      "canvas.join",
      "canvas.groupSep",
      "canvas.vault.group",
      "canvas.removeSep",
      "canvas.vault.delete",
    ]);
    expect(items[0]?.kind === "action" && items[0].label).toBe("Collapse 3 into a stack");

    run(items, "canvas.vault.delete");
    expect(calls.erase).toEqual([["a", "b", "c"]]);
  });

  test("several vault cards can be put into a topic of their own", () => {
    const card = object("a", "file");
    const objects = [card, object("b", "sticky")];
    const { menu, calls } = board({ objects, selection: ["a", "b"] });
    const items = boardMenuItems(card, at, menu);

    expect(items.find((item) => item.id === "canvas.vault.group")).toMatchObject({
      label: "Put 2 into a topic",
    });
    run(items, "canvas.vault.group");
    expect(calls.grouped).toEqual([["a", "b"]]);
  });

  test("one card alone, or a card a plugin put there, has no topic to be put into", () => {
    const card = object("a", "file");
    const { menu } = board({ objects: [card], selection: ["a"] });
    expect(ids(boardMenuItems(card, at, menu))).not.toContain("canvas.vault.group");

    const mixed = board({
      objects: [card, object("m1", "media")],
      selection: ["a", "m1"],
    });
    expect(ids(boardMenuItems(card, at, mixed.menu))).not.toContain("canvas.vault.group");
  });

  test("a card outside the selection is acted on alone", () => {
    const card = object("a", "file");
    const objects = [card, object("b", "file"), object("c", "file")];
    const { menu, calls } = board({ objects, selection: ["b", "c"] });
    const items = boardMenuItems(card, at, menu);

    expect(ids(items)).not.toContain("canvas.stack.collapse");
    run(items, "canvas.vault.delete");
    expect(calls.erase).toEqual([["a"]]);
  });

  test("a pile is taken apart rather than piled again", () => {
    const card = object("a", "file");
    const { menu, calls } = board({
      objects: [card, object("b", "file")],
      selection: ["a", "b"],
      stackOf: () => "stack-1",
    });
    const items = boardMenuItems(card, at, menu);

    expect(ids(items)).toContain("canvas.stack.dissolve");
    expect(ids(items)).not.toContain("canvas.stack.collapse");
    run(items, "canvas.stack.dissolve");
    expect(calls.dissolved).toEqual(["stack-1"]);
  });

  test("cards in different piles are not one pile", () => {
    const card = object("a", "file");
    const { menu } = board({
      objects: [card, object("b", "file")],
      selection: ["a", "b"],
      stackOf: (id) => (id === "a" ? "stack-1" : "stack-2"),
    });
    const items = boardMenuItems(card, at, menu);

    expect(ids(items)).not.toContain("canvas.stack.dissolve");
    expect(ids(items)).toContain("canvas.stack.collapse");
  });

  test("paper colours are offered for notes only, as one swatch row", () => {
    const note = object("a", "sticky");
    const { menu, calls } = board({
      objects: [note, object("b", "sticky")],
      selection: ["a", "b"],
    });
    const items = boardMenuItems(note, at, menu);

    const swatches = items.find((item) => item.id === "canvas.paint");
    if (swatches?.kind !== "swatches") throw new Error("the notes have no swatch row");
    expect(swatches.swatches.map((swatch) => swatch.id)).toContain("yellow");
    swatches.run("yellow");
    expect(calls.paint).toEqual([[["a", "b"], "yellow"]]);
  });

  test("a note among pictures has no paper to paint", () => {
    const note = object("a", "sticky");
    const { menu } = board({
      objects: [note, object("b", "visual")],
      selection: ["a", "b"],
    });
    expect(ids(boardMenuItems(note, at, menu))).not.toContain("canvas.paint");
  });

  test("a topic can be looked into and opened", () => {
    const folder = object("topic", "folder");
    const { menu } = board({ objects: [folder], selection: ["topic"] });
    const items = boardMenuItems(folder, at, menu);

    expect(ids(items)).toContain("canvas.vault.preview");
    expect(ids(items)).toContain("canvas.vault.enter");
    expect(items.find((item) => item.id === "canvas.vault.delete")).toMatchObject({
      label: "Delete this topic",
    });
  });

  test("unlinking is offered only where every card can be unlinked", () => {
    const card = object("a", "file");
    const objects = [card, object("b", "file")];
    const { menu, calls } = board({
      objects,
      selection: ["a", "b"],
      canUnlink: () => true,
    });
    const items = boardMenuItems(card, at, menu);
    run(items, "canvas.vault.unlink");
    expect(calls.unlink).toEqual([["a", "b"]]);

    const partial = board({ objects, selection: ["a", "b"], canUnlink: (id) => id === "a" });
    expect(ids(boardMenuItems(card, at, partial.menu))).not.toContain("canvas.vault.unlink");
  });

  test("an object a plugin put there starts a workstream and is only removed", () => {
    const picture = object("m1", "media");
    const { menu, calls } = board({
      objects: [picture],
      selection: ["m1"],
      carries: () => true,
    });
    const items = boardMenuItems(picture, at, menu);

    run(items, "canvas.startFromObject");
    expect(calls.startWorkstream).toEqual([["m1"]]);

    run(items, "canvas.deleteObject");
    expect(calls.remove).toEqual([["m1"]]);
    expect(ids(items)).not.toContain("canvas.vault.delete");
  });

  test("a mixed selection is taken off the board rather than deleted", () => {
    const card = object("a", "file");
    const { menu, calls } = board({
      objects: [card, object("m1", "media")],
      selection: ["a", "m1"],
    });
    const items = boardMenuItems(card, at, menu);

    expect(ids(items)).not.toContain("canvas.vault.delete");
    run(items, "canvas.deleteObject");
    expect(calls.remove).toEqual([["a", "m1"]]);
  });

  test("a workstream opens its transcript", () => {
    const card = object("w1", "workstream");
    const { menu } = board({ objects: [card], selection: ["w1"] });
    const items = boardMenuItems(card, at, menu);

    expect(ids(items)).toEqual(["canvas.open", "canvas.removeSep", "canvas.deleteObject"]);
  });
});

describe("backdropMenuItems", () => {
  test("offers what can be made here, each at the point clicked", () => {
    const points: Record<string, typeof at> = {};
    const items = backdropMenuItems(at, icons, {
      writeNote: (point) => (points["note"] = point),
      paste: (point) => (points["paste"] = point),
    });

    expect(ids(items)).toEqual([
      "canvas.backdrop.note",
      "canvas.backdrop.pasteSep",
      "canvas.backdrop.paste",
    ]);

    run(items, "canvas.backdrop.note");
    run(items, "canvas.backdrop.paste");
    expect(points).toEqual({ note: at, paste: at });
  });
});
