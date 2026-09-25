import { describe, expect, test } from "bun:test";
import { renderPaneTypes, renderSnapshot } from "../render.ts";
import type { Snapshot } from "../snapshot.ts";

const snapshot: Snapshot = {
  window: { width: 1440, height: 900 },
  project: "/home/someone/work/demo",
  camera: { x: 0, y: 0, zoom: 1 },
  focusedPane: "pane-1-aa",
  board: {
    box: { x: 0, y: 0, width: 984, height: 900 },
    elements: [{ ref: "e1", role: "button", name: "Zoom in", at: "960,20", size: "24x24" }],
    cards: [
      {
        ref: "c1",
        id: "notes",
        kind: "folder",
        title: "notes",
        at: "140,200",
        size: "280x400",
        visible: true,
      },
      {
        ref: "c2",
        id: "far",
        kind: "sticky",
        title: "far",
        at: "4000,200",
        size: "256x154",
        visible: false,
      },
    ],
  },
  docks: [
    {
      edge: "right",
      size: 0,
      tree: {
        kind: "split",
        axis: "column",
        sizes: [0.5, 0.5],
        children: [
          {
            kind: "leaf",
            instanceId: "pane-1-aa",
            paneId: "git",
            title: "Git",
            focused: true,
            width: 456,
            height: 450,
            elements: [
              {
                ref: "e2",
                role: "button",
                name: "Commit",
                at: "1200,40",
                size: "80x24",
                disabled: true,
              },
            ],
          },
          {
            kind: "leaf",
            instanceId: "pane-2-bb",
            paneId: "chat",
            title: "Chat",
            focused: false,
            width: 456,
            height: 450,
            elements: [],
          },
        ],
      },
    },
  ],
  overlays: [],
  errors: { count: 1, recent: ["TypeError: boom\n    at somewhere"] },
};

describe("renderSnapshot", () => {
  test("draws the board, its cards and a dock as a tree", () => {
    expect(renderSnapshot(snapshot)).toBe(
      [
        "nib  1440x900  project=…/work/demo",
        "focus=pane-1-aa  camera=0,0 zoom=1.00  errors=1",
        "",
        "board  984x900",
        '  folder "notes" c1  at=140,200  280x400',
        "  (1 more off screen — pan or zoom to reach them)",
        '  button "Zoom in" e1',
        "",
        "dock right",
        "  split  column  50% 50%",
        "  ├─ pane-1-aa  git  456x450  ★focus",
        '  │       button "Commit" e2 (disabled)',
        "  └─ pane-2-bb  chat  456x450",
        "          (nothing to act on)",
        "",
        'console errors (1, last 1 — "debug logs" for all):',
        "  TypeError: boom",
      ].join("\n"),
    );
  });
});

describe("renderPaneTypes", () => {
  test("lists each type with its open instances", () => {
    const text = renderPaneTypes([
      { id: "git", kind: "git", title: "Git", open: ["pane-1-aa"] },
      { id: "settings", kind: "settings", title: "Settings", open: [] },
    ]);
    expect(text).toBe(
      [
        '2 pane types — "debug pane <id>" opens one',
        "",
        "git       Git       git  open: pane-1-aa",
        "settings  Settings  settings",
      ].join("\n"),
    );
  });
});
