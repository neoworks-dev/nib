import { beforeEach, describe, expect, test } from "bun:test";
import type { PaneKind, PaneLayout, PaneProps } from "@nib-ui/ui-contracts";
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

  test("a snapshot holds plain values, not live state", () => {
    panes.open("git");
    const layout = panes.snapshotLayout();
    panes.close("git");

    expect(layout.docks).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
  });
});
