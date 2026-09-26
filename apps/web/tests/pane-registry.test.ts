import { beforeEach, describe, expect, test } from "bun:test";
import type { PaneKind, PaneLayout, PaneProps, PaneSheet } from "@nib-ui/ui-contracts";
import type { Component } from "svelte";
import { dockPixels, MIN_BOARD_WIDTH, MIN_DOCK_WIDTH } from "../src/lib/client/layout/docks";
import { listLeaves } from "../src/lib/client/layout/tree";
import { PaneAttachments } from "../src/lib/client/registries/attachments";
import { ReactivePaneRegistry, rootPaneId } from "../src/lib/client/registries/panes.svelte";

const component = {} as Component<PaneProps>;

const bounds = { width: 1200, height: 800 };

let panes: ReactivePaneRegistry;
let attachments: PaneAttachments;

function register(id: string, kind: PaneKind, title = id) {
  return panes.register({ id, kind, title, component });
}

/** A chat that opens in the drawer and a note and a node editor that open as sheets. */
function registerLayered(): void {
  panes.register({
    id: "chat.drawer",
    kind: "chat",
    title: "Chat",
    component,
    presentation: "drawer",
  });
  panes.register({ id: "note", kind: "editor", title: "Note", component, presentation: "sheet" });
  panes.register({
    id: "nodes",
    kind: "comfyui-editor",
    title: "Nodes",
    component,
    presentation: "sheet",
  });
}

/** The sheet at a place in the stack, oldest first; -1 is the front one. */
function sheetAt(index: number): PaneSheet {
  const sheet = panes.sheets.at(index);
  if (!sheet) throw new Error(`no sheet at ${index}`);
  return sheet;
}

function leavesOf(instanceId: string): string[] {
  const dock = panes.dockOf(instanceId);
  return dock ? listLeaves(dock.root) : [];
}

function edgesOpen(): string[] {
  return panes.docks.map((dock) => dock.edge);
}

beforeEach(() => {
  panes = new ReactivePaneRegistry();
  attachments = new PaneAttachments(panes);
  panes.setBounds(bounds);
  register(rootPaneId, "canvas", "Canvas");
  register("git", "git", "Git");
  register("files.viewer", "editor", "Editor");
  register("chat", "chat", "Chat");
});

describe("opening", () => {
  test("a pane docks against the right edge rather than floating over the board", () => {
    const instanceId = panes.open("git");

    expect(panes.isOpen("git")).toBe(true);
    expect(panes.isInstanceOpen(instanceId)).toBe(true);
    expect(edgesOpen()).toEqual(["right"]);
    expect(leavesOf(instanceId)).toEqual([instanceId]);
  });

  test("the second pane splits that dock below the first", () => {
    const git = panes.open("git");
    const editor = panes.open("files.viewer");

    expect(edgesOpen()).toEqual(["right"]);
    expect(leavesOf(git)).toEqual([git, editor]);
    expect(panes.dock("right")?.root).toMatchObject({ kind: "split", axis: "column" });
  });

  test("opening again without params reuses the newest instance", () => {
    const first = panes.open("git");

    expect(panes.open("git")).toBe(first);
    expect(panes.instances("git")).toHaveLength(1);
    expect(leavesOf(first)).toEqual([first]);
  });

  test("params of their own make a second instance of the same pane", () => {
    const first = panes.open("chat", { sessionId: "s1" });
    const second = panes.open("chat", { sessionId: "s2" });

    expect(second).not.toBe(first);
    expect(panes.instances("chat")).toHaveLength(2);
    expect(leavesOf(first)).toEqual([first, second]);
  });

  test("the same params reach the instance that already has them", () => {
    const first = panes.open("chat", { sessionId: "s1" });
    panes.open("chat", { sessionId: "s2" });

    expect(panes.open("chat", { sessionId: "s1" })).toBe(first);
    expect(panes.instances("chat")).toHaveLength(2);
  });

  test("a further instance is explicit, never guessed from a repeated call", () => {
    const first = panes.open("chat", { sessionId: "s1" });
    const second = panes.openInstance("chat", { sessionId: "s1" });

    expect(second).not.toBe(first);
    expect(panes.instances("chat")).toHaveLength(2);
  });

  test("the root pane is the shell itself and is never docked", () => {
    expect(panes.open(rootPaneId)).toBe(rootPaneId);
    expect(panes.docks).toHaveLength(0);
    expect(panes.isOpen(rootPaneId)).toBe(true);
  });

  test("the newly opened pane is the focused one", () => {
    panes.open("git");
    const editor = panes.open("files.viewer");

    expect(panes.focusedInstanceId).toBe(editor);
  });

  test("focus follows the instance that was attached, and survives its neighbour closing", () => {
    const chat = panes.open("chat", { sessionId: "s1" });
    const editor = panes.open("files.viewer");
    panes.attach(editor, chat, "right");

    expect(panes.focusedInstanceId).toBe(editor);

    panes.closeInstance(editor);
    expect(panes.focusedInstanceId).toBe(chat);
  });
});

describe("re-keying an open instance", () => {
  test("the instance keeps its place and its dock, and answers to the new params", () => {
    const chat = panes.open("chat", { sessionId: "s1" });
    panes.reparam(chat, { sessionId: "s2" });

    expect(panes.instance(chat)?.params).toEqual({ sessionId: "s2" });
    expect(panes.dockOf(chat)?.edge).toBe("right");
    expect(panes.instances("chat")).toHaveLength(1);
  });

  test("opening on the new params reaches it, and on the old ones does not", () => {
    const chat = panes.open("chat", { sessionId: "s1" });
    panes.reparam(chat, { sessionId: "s2" });

    expect(panes.open("chat", { sessionId: "s2" })).toBe(chat);
    expect(panes.open("chat", { sessionId: "s1" })).not.toBe(chat);
  });

  test("what a neighbour reads off it is re-keyed too", () => {
    const chat = panes.open("chat", { sessionId: "s1" });
    const editor = panes.open("files.viewer");
    panes.attach(editor, chat, "right");
    panes.reparam(chat, { sessionId: "s2" });

    expect(attachments.find(editor, "chat")?.params).toEqual({ sessionId: "s2" });
  });

  test("dropping the params leaves the instance keyed to nothing in particular", () => {
    const chat = panes.open("chat", { sessionId: "s1" });
    panes.reparam(chat);

    expect(panes.instance(chat)?.params).toBeUndefined();
  });

  test("an instance that is not open is not re-keyed into existence", () => {
    panes.reparam("pane-nowhere", { sessionId: "s1" });

    expect(panes.instances()).toHaveLength(0);
  });
});

describe("closing", () => {
  test("closing the last instance takes its dock with it", () => {
    const instanceId = panes.open("git");
    panes.closeInstance(instanceId);

    expect(panes.docks).toHaveLength(0);
    expect(panes.isOpen("git")).toBe(false);
    expect(panes.focusedInstanceId).toBeNull();
  });

  test("closing by pane id closes every instance of it", () => {
    panes.open("chat", { sessionId: "s1" });
    panes.open("chat", { sessionId: "s2" });
    panes.close("chat");

    expect(panes.instances("chat")).toHaveLength(0);
    expect(panes.docks).toHaveLength(0);
  });

  test("a shared dock survives one of its panes closing", () => {
    const git = panes.open("git");
    const editor = panes.open("files.viewer");
    panes.closeInstance(git);

    expect(panes.docks).toHaveLength(1);
    expect(leavesOf(editor)).toEqual([editor]);
  });

  test("toggling opens then closes the pane", () => {
    panes.toggle("git");
    expect(panes.isOpen("git")).toBe(true);
    panes.toggle("git");
    expect(panes.isOpen("git")).toBe(false);
  });

  test("unregistering a pane closes what it had open", () => {
    const dispose = register("scratch", "terminal");
    panes.open("scratch");
    dispose();

    expect(panes.list().some((entry) => entry.id === "scratch")).toBe(false);
    expect(panes.docks).toHaveLength(0);
  });
});

describe("attachments", () => {
  test("a pane on its own has no siblings", () => {
    const git = panes.open("git");

    expect(attachments.siblings(git)).toEqual([]);
    expect(attachments.siblings("nobody")).toEqual([]);
  });

  test("attaching puts one pane beside another in the dock it is in", () => {
    const git = panes.open("git");
    const editor = panes.open("files.viewer");
    attachments.attach(editor, git, "right");

    expect(panes.docks).toHaveLength(1);
    expect(leavesOf(git)).toEqual([git, editor]);
    expect(attachments.siblings(git).map((entry) => entry.instanceId)).toEqual([editor]);
  });

  test("a sibling is described by what it is, not by which plugin it is", () => {
    const git = panes.open("git");
    const chat = panes.open("chat", { sessionId: "s1" });
    attachments.attach(chat, git, "bottom");

    expect(attachments.find(git, "chat")).toEqual({
      instanceId: chat,
      paneId: "chat",
      kind: "chat",
      title: "Chat",
      params: { sessionId: "s1" },
    });
    expect(attachments.find(git, "browser")).toBeUndefined();
  });

  test("detaching moves the pane to the first edge with no dock on it", () => {
    const git = panes.open("git");
    const editor = panes.open("files.viewer");
    attachments.detach(editor);

    expect(edgesOpen()).toEqual(["right", "bottom"]);
    expect(panes.dockOf(editor)?.edge).toBe("bottom");
    expect(attachments.siblings(editor)).toEqual([]);
    expect(attachments.siblings(git)).toEqual([]);
  });

  test("detaching a pane that is already alone in its dock leaves the layout as it was", () => {
    const git = panes.open("git");
    const docks = panes.snapshotLayout().docks;
    attachments.detach(git);

    expect(panes.snapshotLayout().docks).toEqual(docks);
  });

  test("attaching across docks empties the dock the pane came from", () => {
    const git = panes.open("git");
    const editor = panes.open("files.viewer");
    attachments.detach(editor);
    attachments.attach(editor, git, "bottom");

    expect(edgesOpen()).toEqual(["right"]);
    expect(leavesOf(git)).toEqual([git, editor]);
  });
});

describe("docking against an edge", () => {
  test("a pane dropped on another edge takes a dock of its own there", () => {
    const git = panes.open("git");
    const editor = panes.open("files.viewer");
    panes.attachToEdge(editor, "left");

    expect(edgesOpen()).toEqual(["right", "left"]);
    expect(leavesOf(git)).toEqual([git]);
    expect(leavesOf(editor)).toEqual([editor]);
  });

  test("a pane dropped on an edge that already has a dock splits it along its length", () => {
    const git = panes.open("git");
    const editor = panes.open("files.viewer");
    panes.attachToEdge(editor, "bottom");
    panes.attachToEdge(git, "bottom");

    expect(edgesOpen()).toEqual(["bottom"]);
    expect(leavesOf(git)).toEqual([editor, git]);
    expect(panes.dock("bottom")?.root).toMatchObject({ kind: "split", axis: "row" });
  });

  test("a pane that is the whole of its dock stays put when dropped back on that edge", () => {
    const git = panes.open("git");
    const before = panes.snapshotLayout().docks;
    panes.attachToEdge(git, "right");

    expect(panes.snapshotLayout().docks).toEqual(before);
  });

  test("where a pane is let go decides its edge: nothing is left floating", () => {
    const git = panes.open("git");
    panes.open("files.viewer");
    panes.dropAt(git, 12, 400);

    expect(panes.dockOf(git)?.edge).toBe("left");
  });
});

describe("dock size", () => {
  test("a dock opens taking part of the area, never the whole of it", () => {
    panes.open("git");
    const dock = panes.dock("right")!;

    expect(dockPixels("right", dock.size, bounds)).toBeGreaterThanOrEqual(MIN_DOCK_WIDTH);
    expect(dockPixels("right", dock.size, bounds)).toBeLessThanOrEqual(
      bounds.width - MIN_BOARD_WIDTH,
    );
  });

  test("dragging a dock past the board's minimum stops at it", () => {
    panes.open("git");
    panes.setDockSize("right", 1);

    expect(dockPixels("right", panes.dock("right")!.size, bounds)).toBe(
      bounds.width - MIN_BOARD_WIDTH,
    );
  });

  test("a narrower area re-clamps the docks in it rather than leaving them over the board", () => {
    panes.open("git");
    panes.setDockSize("right", 0.6);
    panes.setBounds({ width: 700, height: 500 });

    const pixels = dockPixels("right", panes.dock("right")!.size, { width: 700, height: 500 });
    expect(pixels).toBeLessThanOrEqual(700 - MIN_BOARD_WIDTH);
  });
});

describe("layout persistence", () => {
  test("a snapshot round-trips through restore", () => {
    const git = panes.open("git");
    const editor = panes.open("files.viewer");
    const layout = panes.snapshotLayout();

    const reopened = new ReactivePaneRegistry();
    reopened.setBounds(bounds);
    reopened.register({ id: "git", kind: "git", title: "Git", component });
    reopened.register({ id: "files.viewer", kind: "editor", title: "Editor", component });
    reopened.restoreLayout(layout);

    expect(reopened.docks).toHaveLength(1);
    expect(listLeaves(reopened.docks[0]!.root)).toEqual([git, editor]);
    expect(reopened.instances()).toHaveLength(2);
  });

  test("an instance of a pane no build provides is dropped, the rest is kept", () => {
    const git = panes.open("git");
    const editor = panes.open("files.viewer");
    const layout = panes.snapshotLayout();

    const reopened = new ReactivePaneRegistry();
    reopened.register({ id: "git", kind: "git", title: "Git", component });
    reopened.restoreLayout(layout);

    expect(reopened.instances().map((entry) => entry.instanceId)).toEqual([git]);
    expect(reopened.docks).toHaveLength(1);
    expect(reopened.isInstanceOpen(editor)).toBe(false);
  });

  test("a stored dock too wide for the area it reopens in is cut back to it", () => {
    const instanceId = panes.open("git");
    const layout = panes.snapshotLayout();
    layout.docks[0]!.size = 0.95;

    const reopened = new ReactivePaneRegistry();
    reopened.setBounds({ width: 1000, height: 700 });
    reopened.register({ id: "git", kind: "git", title: "Git", component });
    reopened.restoreLayout(layout);

    expect(dockPixels("right", reopened.docks[0]!.size, { width: 1000, height: 700 })).toBe(
      1000 - MIN_BOARD_WIDTH,
    );
    expect(reopened.isInstanceOpen(instanceId)).toBe(true);
  });

  test("an empty or missing layout restores to no panes at all", () => {
    panes.open("git");
    panes.restoreLayout(undefined);

    expect(panes.docks).toEqual([]);
    expect(panes.instances()).toEqual([]);

    panes.restoreLayout({ docks: [], instances: [] } as PaneLayout);
    expect(panes.docks).toEqual([]);
  });

  test("a pane stored in a dock that now asks for a layer reopens in it", () => {
    const git = panes.open("git");
    const chat = panes.open("chat");
    const layout = panes.snapshotLayout();

    const reopened = new ReactivePaneRegistry();
    reopened.setBounds(bounds);
    reopened.register({ id: "git", kind: "git", title: "Git", component });
    reopened.register({
      id: "chat",
      kind: "chat",
      title: "Chat",
      component,
      presentation: "drawer",
    });
    reopened.restoreLayout(layout);

    expect(reopened.dock("right")?.root).toEqual({ kind: "leaf", instanceId: git });
    expect(reopened.drawer && listLeaves(reopened.drawer.root)).toEqual([chat]);
    expect(reopened.instances()).toHaveLength(2);
  });

  test("the drawer and the sheets round-trip through restore, front sheet focused", () => {
    registerLayered();
    const chat = panes.open("chat.drawer");
    const back = panes.openInstance("note", { path: "a.md" });
    const front = panes.openInstance("note", { path: "b.md" });
    const layout = panes.snapshotLayout();

    const reopened = new ReactivePaneRegistry();
    reopened.setBounds(bounds);
    for (const definition of panes.list()) reopened.register(definition);
    reopened.restoreLayout(layout);

    expect(reopened.drawer && listLeaves(reopened.drawer.root)).toEqual([chat]);
    expect(reopened.sheets.map((sheet) => listLeaves(sheet.root))).toEqual([[back], [front]]);
    expect(reopened.focusedInstanceId).toBe(front);
  });

  test("a snapshot holds plain values, not live state", () => {
    panes.open("git");
    const layout = panes.snapshotLayout();
    panes.close("git");

    expect(layout.docks).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
  });
});

describe("drawer and sheets", () => {
  beforeEach(registerLayered);

  test("a drawer pane opens over the board, taking no dock", () => {
    const chat = panes.open("chat.drawer");

    expect(panes.docks).toEqual([]);
    expect(panes.drawer && listLeaves(panes.drawer.root)).toEqual([chat]);
    expect(panes.frameOf(chat)).toEqual({ layer: "drawer" });
  });

  test("a second chat splits the drawer below the first", () => {
    const first = panes.openInstance("chat.drawer");
    const second = panes.openInstance("chat.drawer");

    expect(panes.drawer?.root).toMatchObject({ kind: "split", axis: "column" });
    expect(panes.drawer && listLeaves(panes.drawer.root)).toEqual([first, second]);
  });

  test("a pane attached to a chat joins the drawer", () => {
    const chat = panes.open("chat.drawer");
    const git = panes.open("git");
    attachments.attach(git, chat, "right");

    expect(panes.docks).toEqual([]);
    expect(attachments.siblings(chat).map((entry) => entry.instanceId)).toEqual([git]);
  });

  test("each sheet pane rises as a sheet of its own, the newest in front", () => {
    const note = panes.open("note", { path: "a.md" });
    const nodes = panes.open("nodes");

    expect(panes.sheets.map((sheet) => listLeaves(sheet.root))).toEqual([[note], [nodes]]);
    expect(panes.focusedInstanceId).toBe(nodes);
  });

  test("opening a sheet that is already up brings it to the front", () => {
    const note = panes.open("note", { path: "a.md" });
    panes.open("nodes");
    panes.open("note", { path: "a.md" });

    expect(listLeaves(sheetAt(-1).root)).toEqual([note]);
    expect(panes.sheets).toHaveLength(2);
  });

  test("dismissing a sheet closes what is on it, and focus falls to the one behind", () => {
    const note = panes.open("note", { path: "a.md" });
    const nodes = panes.open("nodes");
    panes.closeSheet(sheetAt(-1).sheetId);

    expect(panes.isInstanceOpen(nodes)).toBe(false);
    expect(panes.sheets).toHaveLength(1);
    expect(panes.focusedInstanceId).toBe(note);
  });

  test("closing the last pane of a sheet takes the sheet down", () => {
    const note = panes.open("note", { path: "a.md" });
    panes.closeInstance(note);

    expect(panes.sheets).toEqual([]);
  });

  test("a docked pane attached to a sheet pane shares its sheet", () => {
    const note = panes.open("note", { path: "a.md" });
    const git = panes.openInstance("git");
    attachments.attach(git, note, "left");

    expect(panes.docks).toEqual([]);
    expect(listLeaves(sheetAt(0).root)).toEqual([git, note]);
  });

  test("dragging keeps a drawer pane in the drawer and off the sheets", () => {
    const chat = panes.open("chat.drawer");
    const note = panes.open("note", { path: "a.md" });
    panes.open("git");

    expect(panes.canDragInto(chat, { layer: "dock", edge: "right" })).toBe(false);
    expect(panes.canDragInto(chat, { layer: "sheet", sheetId: sheetAt(0).sheetId })).toBe(false);
    expect(panes.canDragInto(note, { layer: "drawer" })).toBe(false);
  });

  test("a docked pane can be dragged into the drawer, but not onto a sheet", () => {
    panes.open("chat.drawer");
    panes.open("note", { path: "a.md" });
    const git = panes.open("git");

    expect(panes.canDragInto(git, { layer: "drawer" })).toBe(true);
    expect(panes.canDragInto(git, { layer: "sheet", sheetId: sheetAt(0).sheetId })).toBe(false);
  });

  test("the drawer's width is held inside what the board can spare", () => {
    panes.open("chat.drawer");
    panes.setDrawerSize(0.99);

    const size = panes.drawer?.size ?? 0;
    expect(dockPixels("right", size, bounds)).toBe(bounds.width - MIN_BOARD_WIDTH);
  });
});
