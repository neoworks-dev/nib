// What is on screen, as the layout it actually is: the board in the middle, the
// docks of panes around it, and what can be acted on inside each.
//
// A flat list of buttons says nothing about where they are, and the board's
// cards are drawn by Pixi and are not in the DOM at all. So the layout comes
// from the pane registry, the cards from the canvas state through the camera,
// and every DOM element hangs off the pane or board that contains it.
//
// Refs are written to disk so the next invocation can resolve them. They are
// only valid until the screen changes; a stale one is an error, never a click
// somewhere unintended.

import { writeFileSync } from "node:fs";
import type { Page } from "playwright-core";
import type {
  Box,
  CardEntry,
  LayoutNode,
  PaneSummary,
  ProbeCard,
  ProbeElement,
  RendererState,
  Snapshot,
  TreeNode,
} from "../snapshot.ts";
import { MISSING_HANDLE, type NibWindow } from "./window.ts";

/** An element as the probe script finds it, with what the driver needs to find it again. */
export interface ElementEntry {
  ref: string;
  role: string;
  name: string;
  selector: string;
  box: Box;
  disabled?: boolean;
  /** The pane instance it sits in, "board" for the board, null for anything outside both. */
  owner: string | null;
}

/** What `probe` leaves on disk for the next command to resolve refs against. */
export interface RefsFile {
  elements: ElementEntry[];
  cards: CardEntry[];
}

/** Take a snapshot, write its refs, and narrow it to a filter when one was given. */
export async function probe(page: Page, refsPath: string, filter: unknown): Promise<Snapshot> {
  const taken = await snapshot(page, refsPath);
  if (typeof filter !== "string") return taken;
  return filterSnapshot(taken, filter);
}

/** The docks, the board, the elements and the app's own state, in one pass. */
export async function snapshot(page: Page, refsPath: string): Promise<Snapshot> {
  const [elements, state] = await Promise.all([
    page.evaluate(probeScript),
    page.evaluate(stateScript, MISSING_HANDLE),
  ]);
  const refs: RefsFile = { elements, cards: state.cards };
  writeFileSync(refsPath, JSON.stringify(refs, null, 2), "utf8");

  const byOwner = new Map<string | null, ProbeElement[]>();
  for (const entry of elements) {
    const bucket = byOwner.get(entry.owner) ?? [];
    bucket.push(describeElement(entry));
    byOwner.set(entry.owner, bucket);
  }

  const panesById = new Map(state.panes.map((pane) => [pane.instanceId, pane]));
  const docks = state.docks.map((dock) => ({
    edge: dock.edge,
    size: dock.size,
    tree: attachElements(dock.root, panesById, state.paneBoxes, byOwner),
  }));

  let focusedPane: string | null = null;
  const focused = state.panes.find((pane) => pane.focused);
  if (focused) focusedPane = focused.instanceId;

  const result: Snapshot = {
    window: state.window,
    project: state.project,
    camera: state.camera,
    focusedPane,
    board: {
      box: state.boardBox,
      elements: byOwner.get("board") ?? [],
      cards: state.cards.map(({ box: _box, ...card }) => card),
    },
    docks,
    overlays: byOwner.get(null) ?? [],
    errors: state.errors,
  };
  if (state.error !== undefined) result.error = state.error;
  return result;
}

/** One element as a probe reader sees it: how to name it, and where it is. */
function describeElement(entry: ElementEntry): ProbeElement {
  const element: ProbeElement = {
    ref: entry.ref,
    role: entry.role,
    name: entry.name,
    at: `${Math.round(entry.box.x + entry.box.width / 2)},${Math.round(entry.box.y + entry.box.height / 2)}`,
    size: `${Math.round(entry.box.width)}x${Math.round(entry.box.height)}`,
  };
  if (entry.disabled) element.disabled = true;
  return element;
}

/** Hang each pane's summary, rendered size and elements off its leaf. */
function attachElements(
  node: LayoutNode,
  panes: Map<string, PaneSummary>,
  boxes: Record<string, Box>,
  byOwner: Map<string | null, ProbeElement[]>,
): TreeNode {
  if (node.kind === "split") {
    return {
      kind: "split",
      axis: node.axis,
      sizes: node.sizes,
      children: node.children.map((child) => attachElements(child, panes, boxes, byOwner)),
    };
  }
  let summary = panes.get(node.instanceId);
  if (summary === undefined) {
    summary = { instanceId: node.instanceId, paneId: "?", title: "?", focused: false };
  }
  const box = boxes[node.instanceId];
  return {
    ...summary,
    kind: "leaf",
    width: Math.round(box?.width ?? 0),
    height: Math.round(box?.height ?? 0),
    elements: byOwner.get(node.instanceId) ?? [],
  };
}

/**
 * Keep only the elements and cards a filter names.
 *
 * The panes stay: which of them holds the match is most of the answer.
 */
function filterSnapshot(taken: Snapshot, filter: string): Snapshot {
  const needle = filter.toLowerCase();
  const matches = (element: ProbeElement): boolean =>
    element.name.toLowerCase().includes(needle) ||
    element.role.includes(needle) ||
    element.ref === needle;
  const cardMatches = (card: ProbeCard): boolean =>
    card.title.toLowerCase().includes(needle) || card.kind.includes(needle) || card.ref === needle;

  const prune = (node: TreeNode): TreeNode => {
    if (node.kind === "split") return { ...node, children: node.children.map(prune) };
    return { ...node, elements: node.elements.filter(matches) };
  };

  return {
    ...taken,
    filter,
    board: {
      box: taken.board.box,
      elements: taken.board.elements.filter(matches),
      cards: taken.board.cards.filter(cardMatches),
    },
    docks: taken.docks.map((dock) => ({ ...dock, tree: prune(dock.tree) })),
    overlays: taken.overlays.filter(matches),
  };
}

/**
 * Collect the interactive elements in the page, in reading order.
 *
 * Serialised into the renderer, so it stands alone — nothing here may close
 * over anything in this module.
 */
const probeScript = (): ElementEntry[] => {
  const SELECTOR = [
    "button",
    "a[href]",
    "input",
    "textarea",
    "select",
    "[role=button]",
    "[role=tab]",
    "[role=treeitem]",
    "[role=menuitem]",
    "[role=menuitemcheckbox]",
    "[role=menuitemradio]",
    "[role=option]",
    "[role=row]",
    "[role=gridcell]",
    "[role=combobox]",
    "[role=switch]",
    "[role=separator]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=textbox]",
    "[contenteditable=true]",
    "[data-testid]",
    "canvas",
  ].join(",");

  const selectorFor = (element: Element): string => {
    const steps: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.documentElement) {
      const node: Element = current;
      const parent: Element | null = node.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === node.tagName,
      );
      steps.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
      current = parent;
    }
    return steps.join(" > ");
  };

  const nameOf = (element: Element): string => {
    const label = element.getAttribute("aria-label");
    if (label) return label.trim();
    const title = element.getAttribute("title");
    if (title) return title.trim();
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 80);
    const testId = element.getAttribute("data-testid");
    if (testId) return testId;
    return "";
  };

  const roleOf = (element: Element): string => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "input") return element.getAttribute("type") ?? "textbox";
    if (tag === "textarea") return "textbox";
    return tag;
  };

  const ownerOf = (element: Element): string | null => {
    const leaf = element.closest("[data-pane-leaf]");
    if (leaf) return leaf.getAttribute("data-pane-leaf");
    if (element.closest("[data-pane-root]")) return "board";
    return null;
  };

  const entries: ElementEntry[] = [];
  let next = 1;
  for (const element of Array.from(document.querySelectorAll(SELECTOR))) {
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") continue;

    const entry: ElementEntry = {
      ref: `e${next}`,
      role: roleOf(element),
      name: nameOf(element),
      selector: selectorFor(element),
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      owner: ownerOf(element),
    };
    if (element.hasAttribute("disabled")) entry.disabled = true;
    entries.push(entry);
    next += 1;
  }
  return entries;
};

/**
 * The app's own account of itself: docks, panes, the board's cards through the
 * camera, and what has gone wrong so far.
 *
 * Serialised into the renderer like `probeScript`, so it stands alone.
 */
const stateScript = (missingHandle: string): RendererState => {
  const view = window as unknown as NibWindow;
  const logged = view.__debug_console ?? [];
  const errorEntries = logged.filter((entry) => entry.level === "error");
  const state: RendererState = {
    window: { width: window.innerWidth, height: window.innerHeight },
    project: null,
    camera: null,
    docks: [],
    panes: [],
    paneBoxes: {},
    boardBox: null,
    cards: [],
    errors: {
      count: errorEntries.length,
      recent: errorEntries.slice(-5).map((entry) => entry.text),
    },
  };
  const debug = view.__nib_debug;
  if (!debug) return { ...state, error: missingHandle };

  const boxOf = (element: Element): Box => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };

  for (const element of Array.from(document.querySelectorAll("[data-pane-leaf]"))) {
    const id = element.getAttribute("data-pane-leaf");
    if (id !== null) state.paneBoxes[id] = boxOf(element);
  }
  const root = document.querySelector("[data-pane-root]");
  if (root) state.boardBox = boxOf(root);

  const titles = new Map(
    debug.panes.definitions.map((definition) => [definition.id, definition.title]),
  );
  state.panes = debug.panes.openPanes.map((instance) => {
    const summary: PaneSummary = {
      instanceId: instance.instanceId,
      paneId: instance.paneId,
      title: titles.get(instance.paneId) ?? instance.paneId,
      focused: debug.panes.focusedInstanceId === instance.instanceId,
    };
    if (instance.params) summary.params = JSON.parse(JSON.stringify(instance.params));
    return summary;
  });
  state.docks = JSON.parse(JSON.stringify(debug.panes.docks));

  const canvas = debug.canvas;
  state.project = canvas.vault.cwd || null;
  const camera = canvas.registry.camera;
  state.camera = { x: camera.x, y: camera.y, zoom: camera.zoom };

  // worldToScreen is relative to the board's own canvas element.
  const surface = root?.querySelector("canvas");
  let origin = { x: 0, y: 0 };
  if (surface) {
    const rect = surface.getBoundingClientRect();
    origin = { x: rect.x, y: rect.y };
  }
  const titleOf = (object: Record<string, unknown>): string => {
    for (const key of ["title", "name", "path", "goal", "text", "url"]) {
      const value = object[key];
      if (typeof value === "string" && value.length > 0) return value.slice(0, 80);
    }
    return "";
  };

  let next = 1;
  for (const object of canvas.objects) {
    const { x, y, w, h } = object;
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (typeof w !== "number" || typeof h !== "number") continue;
    const topLeft = canvas.registry.worldToScreen(x, y);
    const left = origin.x + topLeft.x;
    const top = origin.y + topLeft.y;
    const width = w * camera.zoom;
    const height = h * camera.zoom;
    let visible = false;
    const board = state.boardBox;
    if (board) {
      visible =
        left < board.x + board.width &&
        left + width > board.x &&
        top < board.y + board.height &&
        top + height > board.y;
    }
    state.cards.push({
      ref: `c${next}`,
      id: object.id,
      kind: object.kind,
      title: titleOf(object),
      at: `${Math.round(left + width / 2)},${Math.round(top + height / 2)}`,
      size: `${Math.round(width)}x${Math.round(height)}`,
      visible,
      box: { x: left, y: top, width, height },
    });
    next += 1;
  }
  return state;
};
