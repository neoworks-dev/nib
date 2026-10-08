// What `debug probe` prints: the app as the board and the docks around it, with
// what can be acted on inside each.
//
// Text rather than JSON, and text rather than a screenshot. A picture costs an
// agent thousands of tokens to be told what a dozen lines say exactly — which
// panes are open, which has focus, what is on the board and what to call it.

import type { PaneTypeEntry } from "./driver/panes.ts";
import type { ProbeCard, ProbeElement, Snapshot, TreeNode } from "./snapshot.ts";

/** Where element lists wrap, wide enough for a long label to stay on one line. */
const WRAP_COLUMNS = 96;

/** The whole snapshot as the lines a reader sees. */
export function renderSnapshot(snapshot: Snapshot): string {
  const lines = [...headerLines(snapshot), "", ...boardLines(snapshot)];
  for (const dock of snapshot.docks) {
    // The drawer and the sheets arrive as docks named after their layer.
    const layer = dock.edge === "drawer" || dock.edge === "sheet";
    let heading = layer ? dock.edge : `dock ${dock.edge}`;
    // Zero means the dock has not been resized and takes its default size.
    if (dock.size > 0) heading = `${heading}  ${Math.round(dock.size)}px`;
    lines.push("", heading);
    lines.push(...nodeLines(dock.tree, "  "));
  }
  if (snapshot.overlays.length > 0) {
    lines.push("", "overlays (menus, dialogs, the shell — outside the board and the docks)");
    lines.push(...wrapElements(snapshot.overlays, "  "));
  }
  lines.push(...problemLines(snapshot));
  return lines.join("\n");
}

/** The session in two lines: where it is, what has focus, what has gone wrong. */
function headerLines(snapshot: Snapshot): string[] {
  const first = [`nib  ${snapshot.window.width}x${snapshot.window.height}`];
  if (snapshot.project) first.push(`project=${shortPath(snapshot.project)}`);
  if (snapshot.filter !== undefined) first.push(`filter=${JSON.stringify(snapshot.filter)}`);

  const second: string[] = [];
  if (snapshot.focusedPane === null) second.push("focus=board");
  else second.push(`focus=${snapshot.focusedPane}`);
  if (snapshot.camera) {
    const camera = snapshot.camera;
    second.push(
      `camera=${Math.round(camera.x)},${Math.round(camera.y)} zoom=${camera.zoom.toFixed(2)}`,
    );
  }
  second.push(`errors=${snapshot.errors.count}`);
  return [first.join("  "), second.join("  ")];
}

/** The board: its size, its cards, and the DOM controls floating over it. */
function boardLines(snapshot: Snapshot): string[] {
  const board = snapshot.board;
  let size = "not mounted";
  if (board.box) size = `${Math.round(board.box.width)}x${Math.round(board.box.height)}`;
  const lines = [`board  ${size}`];

  const onScreen = board.cards.filter((card) => card.visible);
  const offScreen = board.cards.length - onScreen.length;
  if (board.cards.length === 0) lines.push("  (no cards)");
  for (const card of onScreen) lines.push(`  ${describeCard(card)}`);
  if (offScreen > 0) lines.push(`  (${offScreen} more off screen — pan or zoom to reach them)`);
  if (board.elements.length > 0) lines.push(...wrapElements(board.elements, "  "));
  return lines;
}

/** A card as `kind "title" ref at size`. */
function describeCard(card: ProbeCard): string {
  let text = card.kind;
  if (card.title.length > 0) text = `${text} "${truncate(card.title, 44)}"`;
  return `${text} ${card.ref}  at=${card.at}  ${card.size}`;
}

/** One node of a dock and everything under it, drawn with box characters. */
function nodeLines(node: TreeNode, indent: string): string[] {
  if (node.kind === "leaf") return [`${indent}${paneLine(node)}`, ...paneElements(node, indent)];

  const shares = node.sizes.map((size) => `${Math.round(size * 100)}%`).join(" ");
  const lines = [`${indent}split  ${node.axis}  ${shares}`];
  node.children.forEach((child, index) => {
    const last = index === node.children.length - 1;
    let branch = "├─ ";
    let childIndent = "│  ";
    if (last) {
      branch = "└─ ";
      childIndent = "   ";
    }
    const rendered = nodeLines(child, `${indent}${childIndent}`);
    const [head = "", ...rest] = rendered;
    // The first line of the child carries the branch; the rest keep the trunk.
    lines.push(`${indent}${branch}${head.slice(indent.length + childIndent.length)}`);
    lines.push(...rest);
  });
  return lines;
}

/** A pane: its instance id, its type, how big it is, and whether it has focus. */
function paneLine(node: Extract<TreeNode, { kind: "leaf" }>): string {
  const parts = [`${node.instanceId}  ${node.paneId}`];
  if (node.title.toLowerCase() !== node.paneId.toLowerCase()) parts.push(`"${node.title}"`);
  parts.push(`${node.width}x${node.height}`);
  if (node.focused) parts.push("★focus");
  if (node.params) parts.push(`params=${truncate(JSON.stringify(node.params), 60)}`);
  return parts.join("  ");
}

/** A pane's elements, or a note that it has none. */
function paneElements(node: Extract<TreeNode, { kind: "leaf" }>, indent: string): string[] {
  if (node.elements.length === 0) return [`${indent}     (nothing to act on)`];
  return wrapElements(node.elements, `${indent}     `);
}

/** Elements as `role "name" ref`, several to a line, wrapped on the indent. */
function wrapElements(elements: ProbeElement[], indent: string): string[] {
  const lines: string[] = [];
  let current = "";
  for (const element of elements) {
    const text = describeElement(element);
    if (current.length === 0) {
      current = text;
      continue;
    }
    if (indent.length + current.length + text.length + 3 > WRAP_COLUMNS) {
      lines.push(indent + current);
      current = text;
      continue;
    }
    current = `${current} · ${text}`;
  }
  if (current.length > 0) lines.push(indent + current);
  return lines;
}

/** An element as `role "name" ref`. */
function describeElement(element: ProbeElement): string {
  let text = element.role;
  if (element.name.length > 0) text = `${text} "${truncate(element.name, 44)}"`;
  text = `${text} ${element.ref}`;
  if (element.disabled) text = `${text} (disabled)`;
  return text;
}

/** A missing debug handle and the last few console errors, when there are any. */
function problemLines(snapshot: Snapshot): string[] {
  const lines: string[] = [];
  if (snapshot.error) lines.push("", snapshot.error);
  if (snapshot.errors.recent.length > 0) {
    lines.push(
      "",
      `console errors (${snapshot.errors.count}, last ${snapshot.errors.recent.length} — "debug logs" for all):`,
    );
    for (const entry of snapshot.errors.recent) lines.push(`  ${truncate(firstLine(entry), 140)}`);
  }
  return lines;
}

/** Every pane type, one per line: what to open it by, and whether it is open. */
export function renderPaneTypes(entries: PaneTypeEntry[]): string {
  const idWidth = Math.max(4, ...entries.map((entry) => entry.id.length));
  const titleWidth = Math.max(5, ...entries.map((entry) => entry.title.length));
  const lines = entries.map((entry) => {
    let open = "";
    if (entry.open.length > 0) open = `open: ${entry.open.join(" ")}`;
    return `${entry.id.padEnd(idWidth)}  ${entry.title.padEnd(titleWidth)}  ${entry.kind}  ${open}`.trimEnd();
  });
  return [`${entries.length} pane types — "debug pane <id>" opens one`, "", ...lines].join("\n");
}

/** The first line of a multi-line message. */
function firstLine(value: string): string {
  return value.split("\n")[0] ?? "";
}

/** A string cut to `limit` characters, with an ellipsis when it was cut. */
function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

/** Paths are long and mostly the same; the tail is what identifies them. */
function shortPath(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}
