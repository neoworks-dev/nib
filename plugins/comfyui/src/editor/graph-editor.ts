/**
 * One litegraph canvas and the graph on it: loading, saving, undo, and showing
 * a run on the nodes. The pane owns the rest — the toolbar, the parameters, and
 * where a workflow comes from and goes to.
 */

import { LGraph, LGraphCanvas, type LGraphNode, LiteGraph } from "@comfyorg/litegraph";
import type { ComfyGraph, ComfyRun, ComfyValidationIssue } from "@nib-ui/ui-contracts";
import { CONTROL_WIDGET } from "./nodes";

/** Snapshots kept for undo. */
const HISTORY_LIMIT = 100;
/** Graph units kept clear around the nodes when fitting them to the pane. */
const FIT_MARGIN = 40;
/** The seeds a randomized seed widget draws from. */
const RANDOM_SEED_RANGE = 2 ** 32;

/** The node a user has selected: its id and class, for the parameters panel. */
export interface SelectedNode {
  id: string;
  type: string;
  title: string;
}

/**
 * Litegraph draws with colour strings, not CSS; the app's theme variables are
 * read once and handed to it so the graph matches the panes around it.
 */
function applyTheme(canvas: LGraphCanvas): void {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    if (value.length === 0) return fallback;
    return value;
  };
  canvas.clear_background_color = read("--bg", "#141416");
  canvas.background_image = "";
  LiteGraph.NODE_DEFAULT_BGCOLOR = read("--surface", "#1c1c1e");
  LiteGraph.NODE_DEFAULT_COLOR = read("--surface-raised", "#262628");
  LiteGraph.NODE_DEFAULT_BOXCOLOR = read("--border-strong", "#3f3f46");
  LiteGraph.NODE_TITLE_COLOR = read("--text-muted", "#a1a1aa");
  LiteGraph.NODE_SELECTED_TITLE_COLOR = read("--text", "#fafafa");
  LiteGraph.NODE_TEXT_COLOR = read("--text-muted", "#a1a1aa");
  LiteGraph.WIDGET_BGCOLOR = read("--surface-input", "#0e0e10");
  LiteGraph.WIDGET_OUTLINE_COLOR = read("--border", "#29292b");
  LiteGraph.WIDGET_TEXT_COLOR = read("--text", "#fafafa");
  LiteGraph.WIDGET_SECONDARY_TEXT_COLOR = read("--text-dim", "#71717a");
  LiteGraph.LINK_COLOR = read("--text-dim", "#71717a");
}

export class GraphEditor {
  readonly graph = new LGraph();
  readonly canvas: LGraphCanvas;
  private history: string[] = [];
  private future: string[] = [];
  /** Set while a snapshot is being restored, so the restore is not itself recorded. */
  private restoring = false;
  private readonly observer: ResizeObserver;

  constructor(
    private readonly element: HTMLCanvasElement,
    private readonly onChange: () => void,
    onSelect: (node: SelectedNode | null) => void,
  ) {
    this.canvas = new LGraphCanvas(element, this.graph);
    this.canvas.allow_searchbox = true;
    // Litegraph's frame-timing readout, which is for litegraph's own debugging.
    this.canvas.show_info = false;
    applyTheme(this.canvas);
    this.graph.onAfterChange = () => this.record();
    this.canvas.onNodeSelected = (node) => onSelect(selectedNode(node));
    this.canvas.onNodeDeselected = () => onSelect(null);
    this.observer = new ResizeObserver(() => this.resize());
    const parent = element.parentElement;
    if (parent) this.observer.observe(parent);
    this.resize();
  }

  /** Records the graph after an edit litegraph does not report itself, such as a widget value. */
  recordChange(): void {
    this.record();
  }

  /** The value a node's widget shows now, or undefined. */
  widgetValue(nodeId: string, name: string): unknown {
    const node = this.graph.getNodeById(nodeId);
    return node?.widgets?.find((widget) => widget.name === name)?.value;
  }

  /** Empties the canvas for a new workflow. */
  clear(): void {
    this.restoring = true;
    try {
      this.graph.clear();
    } finally {
      this.restoring = false;
    }
    this.history = [JSON.stringify(this.serialize())];
    this.future = [];
    this.canvas.setDirty(true, true);
  }

  /**
   * Replaces the graph, and with it the undo history. A graph laid out here
   * rather than saved from an editor has only estimated node sizes, so
   * `measure` sizes each node to what it draws.
   */
  load(graph: ComfyGraph, measure = false): void {
    this.restoring = true;
    try {
      this.graph.configure(JSON.parse(JSON.stringify(graph)));
      if (measure) {
        for (const node of this.graph.nodes) node.setSize(node.computeSize());
      }
    } finally {
      this.restoring = false;
    }
    this.history = [JSON.stringify(this.serialize())];
    this.future = [];
    // A pane that has just opened is laid out on the next frame.
    requestAnimationFrame(() => this.fit());
    this.onChange();
  }

  /** The graph as ComfyUI's UI format. */
  serialize(): ComfyGraph {
    return JSON.parse(JSON.stringify(this.graph.serialize()));
  }

  /** Steps back to the graph before the last change. */
  undo(): void {
    if (this.history.length < 2) return;
    const current = this.history.pop();
    if (current !== undefined) this.future.push(current);
    this.restore(this.history.at(-1));
  }

  /** Steps forward again after an undo. */
  redo(): void {
    const next = this.future.pop();
    if (next === undefined) return;
    this.history.push(next);
    this.restore(next);
  }

  /** Zooms and pans so every node is on screen. */
  fit(): void {
    const nodes = this.graph.nodes;
    if (nodes.length === 0) return;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of nodes) {
      left = Math.min(left, node.pos[0]);
      top = Math.min(top, node.pos[1] - LiteGraph.NODE_TITLE_HEIGHT);
      right = Math.max(right, node.pos[0] + node.size[0]);
      bottom = Math.max(bottom, node.pos[1] + node.size[1]);
    }
    // Litegraph's own fitToBounds measures the canvas in device pixels, which on a
    // scaled display leaves the graph a fraction of the pane; this measures it as laid out.
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    if (width === 0 || height === 0) return;
    const boundsWidth = right - left + 2 * FIT_MARGIN;
    const boundsHeight = bottom - top + 2 * FIT_MARGIN;
    const scale = Math.min(width / boundsWidth, height / boundsHeight, 1);
    this.canvas.ds.scale = scale;
    this.canvas.ds.offset = [
      width / scale / 2 - (left + right) / 2,
      height / scale / 2 - (top + bottom) / 2,
    ];
    this.canvas.setDirty(true, true);
  }

  /**
   * Seeds whose widget says `randomize` draw a new value, as ComfyUI does when it
   * queues; the change is part of the graph that is saved afterwards.
   */
  randomizeSeeds(): void {
    for (const node of this.graph.nodes) {
      const widgets = node.widgets ?? [];
      widgets.forEach((widget, index) => {
        if (widget.name !== CONTROL_WIDGET || widget.value !== "randomize") return;
        const seed = widgets[index - 1];
        if (seed) seed.value = Math.floor(Math.random() * RANDOM_SEED_RANGE);
      });
    }
    this.canvas.setDirty(true, false);
  }

  /** Shows a run on the nodes: progress on the one executing, the failing one marked. */
  showRun(run: ComfyRun): void {
    for (const node of this.graph.nodes) {
      node.progress = undefined;
      node.has_errors = false;
    }
    const executing = run.nodeId === null ? null : this.graph.getNodeById(run.nodeId);
    if (executing && run.progress) executing.progress = run.progress.value / run.progress.max;
    if (executing && !run.progress) executing.progress = 0;
    if (run.error?.nodeId) this.markNodes([run.error.nodeId]);
    this.canvas.setDirty(true, false);
  }

  /** Marks the nodes named in validation issues. */
  showIssues(issues: readonly ComfyValidationIssue[]): void {
    for (const node of this.graph.nodes) node.has_errors = false;
    const ids: string[] = [];
    for (const issue of issues) {
      if (issue.nodeId !== null) ids.push(issue.nodeId);
    }
    this.markNodes(ids);
    this.canvas.setDirty(true, false);
  }

  dispose(): void {
    this.observer.disconnect();
    this.graph.clear();
  }

  /** Flags nodes as failing, which litegraph draws with a red outline. */
  private markNodes(ids: readonly string[]): void {
    for (const id of ids) {
      const node = this.graph.getNodeById(id);
      if (node) node.has_errors = true;
    }
  }

  /** Records the graph after a change, for undo. */
  private record(): void {
    if (this.restoring) return;
    const snapshot = JSON.stringify(this.serialize());
    if (snapshot === this.history.at(-1)) return;
    this.history.push(snapshot);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
    this.onChange();
  }

  /** Puts a recorded graph back without recording it again. */
  private restore(snapshot: string | undefined): void {
    if (snapshot === undefined) return;
    this.restoring = true;
    try {
      this.graph.configure(JSON.parse(snapshot));
    } finally {
      this.restoring = false;
    }
    this.canvas.setDirty(true, true);
    this.onChange();
  }

  /** Sizes the canvas to its container, in device pixels. */
  private resize(): void {
    const parent = this.element.parentElement;
    if (!parent) return;
    const { width, height } = parent.getBoundingClientRect();
    this.canvas.resize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    this.canvas.setDirty(true, true);
  }
}

/** The selection as the panel reads it. */
function selectedNode(node: LGraphNode): SelectedNode {
  return { id: String(node.id), type: node.type ?? "", title: node.title };
}
