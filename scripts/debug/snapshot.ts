// The shape of what `debug probe` reads out of a running app: the board, the
// docks of panes around it, what each holds, and the app's own account of itself.
//
// Types only, and no imports — the driver runs under node and the renderer of
// this snapshot under bun, and this is the one thing both need to agree on.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An element as `probe` reports it: what to call it, and where it is. */
export interface ProbeElement {
  ref: string;
  role: string;
  name: string;
  at: string;
  size: string;
  disabled?: boolean;
}

/** A card on the board, placed in window coordinates through the camera. */
export interface ProbeCard {
  ref: string;
  id: string;
  kind: string;
  title: string;
  at: string;
  size: string;
  /** Whether any of the card is inside the board's visible area. */
  visible: boolean;
}

/** A card with the box the driver clicks and drags it by. */
export type CardEntry = ProbeCard & { box: Box };

/** A node of a dock's layout, as the pane registry stores it. */
export type LayoutNode =
  | { kind: "leaf"; instanceId: string }
  | { kind: "split"; axis: "row" | "column"; sizes: number[]; children: LayoutNode[] };

/** An open pane: which definition it is an instance of, and its state. */
export interface PaneSummary {
  instanceId: string;
  paneId: string;
  title: string;
  focused: boolean;
  params?: Record<string, unknown>;
}

export interface DockSummary {
  edge: string;
  size: number;
  root: LayoutNode;
}

/** What the renderer reports about itself, before the DOM is joined onto it. */
export interface RendererState {
  window: { width: number; height: number };
  project: string | null;
  camera: { x: number; y: number; zoom: number } | null;
  docks: DockSummary[];
  panes: PaneSummary[];
  paneBoxes: Record<string, Box>;
  boardBox: Box | null;
  cards: CardEntry[];
  errors: { count: number; recent: string[] };
  error?: string;
}

/** A dock's layout once each pane carries its size and elements. */
export type TreeNode =
  | (PaneSummary & { kind: "leaf"; width: number; height: number; elements: ProbeElement[] })
  | { kind: "split"; axis: "row" | "column"; sizes: number[]; children: TreeNode[] };

/** What `probe` prints. */
export interface Snapshot {
  window: { width: number; height: number };
  project: string | null;
  camera: { x: number; y: number; zoom: number } | null;
  focusedPane: string | null;
  board: { box: Box | null; elements: ProbeElement[]; cards: ProbeCard[] };
  docks: Array<{ edge: string; size: number; tree: TreeNode }>;
  /** Everything outside the board and the docks: menus, dialogs, the shell's chrome. */
  overlays: ProbeElement[];
  errors: { count: number; recent: string[] };
  error?: string;
  filter?: string;
}
