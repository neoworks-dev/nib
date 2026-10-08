import type { Disposer } from "@nib-ui/kernel";
import type { SessionView } from "@nib-ui/protocol";
import type { Component } from "svelte";

/**
 * What a pane is, rather than which plugin happens to provide it. Another plugin
 * matches on it to find what it is sitting next to, so an unknown value is legal:
 * a plugin can introduce a kind without this list changing.
 */
export type KnownPaneKind =
  | "canvas"
  | "chat"
  | "desktop"
  | "editor"
  | "explorer"
  /** Sits beside a chat and shows what is under it: the trajectory inspector. */
  | "inspector"
  | "browser"
  | "git"
  | "tasks"
  | "model"
  | "settings"
  | "terminal";

export type PaneKind = KnownPaneKind | (string & {});

/** One open copy of a pane: the same definition can be open several times over. */
export interface PaneInstance {
  instanceId: string;
  paneId: string;
  params?: Record<string, unknown>;
}

export type PaneAxis = "row" | "column";

export type PaneEdge = "left" | "right" | "top" | "bottom";

/** `sizes` are fractions of the split's extent and sum to 1, one per child. */
export type PaneNode =
  | { kind: "leaf"; instanceId: string }
  | { kind: "split"; axis: PaneAxis; children: PaneNode[]; sizes: number[] };

/**
 * A docked pane sits against an edge of the main area rather than over it: the
 * board keeps whatever the docks leave, and it is never nothing. One dock per
 * edge, holding a tree of instances; `size` is the fraction of the area it takes
 * along its own axis — width for a side dock, height for a top or bottom one.
 */
export interface PaneDock {
  edge: PaneEdge;
  size: number;
  root: PaneNode;
}

/**
 * A tree laid over the right side of the board instead of docked beside it: the
 * board keeps its full width underneath. `size` is the fraction of the area's
 * width it takes.
 */
export interface PaneDrawer {
  size: number;
  root: PaneNode;
}

/** A tree raised from the bottom over everything else, until it is dismissed. */
export interface PaneSheet {
  sheetId: string;
  root: PaneNode;
}

export interface PaneLayout {
  docks: PaneDock[];
  instances: PaneInstance[];
  drawer?: PaneDrawer;
  /** Oldest first: the last one is in front. */
  sheets?: PaneSheet[];
}

/**
 * Where a pane opens. `dock` pushes the board aside against an edge; `drawer`
 * slides in over the board's right side; `sheet` rises from the bottom over the
 * whole window, which shrinks back behind it, and holds the user until closed.
 */
export type PanePresentation = "dock" | "drawer" | "sheet";

export interface PaneProps {
  session: SessionView | null;
  /** Which copy of the pane this is, for a pane opened more than once. */
  instanceId: string;
  params?: Record<string, unknown>;
}

export interface PaneDefinition {
  id: string;
  /** Matched on by other plugins; the id names the provider, the kind the role. */
  kind: PaneKind;
  title: string;
  /** Phosphor icon component shown in the pane's title bar and in its trigger. */
  icon?: Component<{ size?: number }>;
  /**
   * How the title bar is drawn. `bar` is the tool-pane default: a bordered strip
   * above the content. `quiet` lays the bar over the top of the content with no
   * background of its own and shows it only while the pointer is over the pane,
   * for a pane that is a page rather than a tool.
   */
  chrome?: "bar" | "quiet";
  /** Where a new instance opens; `dock` when omitted. */
  presentation?: PanePresentation;
  /** A title for one instance, from what it was opened with; falls back to `title`. */
  label?: (params: Record<string, unknown> | undefined) => string;
  component: Component<PaneProps>;
}

/**
 * Panes tile the main area, or lie over it as the drawer and the sheets. A plugin
 * contributes a definition and asks for it to be shown; which layer it opens in
 * is the definition's `presentation`, and where it lands inside that layer is the
 * user's business, not the plugin's.
 */
export interface PaneRegistry {
  register(definition: PaneDefinition): Disposer;
  list(): PaneDefinition[];
  /**
   * Shows the pane and returns the instance now on screen. Without `params` the
   * newest instance of the pane is reused; with them, the instance opened with
   * the same params, or a new one.
   */
  open(paneId: string, params?: Record<string, unknown>): string;
  /** A further instance, even when one with the same params is already open. */
  openInstance(paneId: string, params?: Record<string, unknown>): string;
  /**
   * Re-keys an open instance. What a pane is showing can move under it — a
   * conversation handed to another harness continues in a new session — and the
   * params are what a neighbouring pane reads to tell what it is sitting next to,
   * so they follow rather than go stale.
   */
  reparam(instanceId: string, params?: Record<string, unknown>): void;
  /** Closes every instance of the pane. */
  close(paneId: string): void;
  closeInstance(instanceId: string): void;
  toggle(paneId: string): void;
  isOpen(paneId: string): boolean;
  isInstanceOpen(instanceId: string): boolean;
  /** Open instances, oldest first; every open instance when `paneId` is omitted. */
  instances(paneId?: string): PaneInstance[];
  /**
   * The instance the user is working in, whether it was reached by clicking into
   * it or by its title bar alone. A pane that acts on "the focused one" reads it
   * here rather than tracking pointer events of its own and disagreeing.
   */
  readonly focusedInstanceId: string | null;
}

/** A pane seen from a neighbour: enough to recognise it and to address it. */
export interface PaneAttachment {
  instanceId: string;
  paneId: string;
  kind: PaneKind;
  title: string;
  params?: Record<string, unknown>;
}

/**
 * What a pane is sitting next to. Reads are plain reads of registry state, so a
 * `$derived` over them re-runs when the layout changes — there is nothing to
 * subscribe to and nothing to unsubscribe from.
 */
export interface AttachmentsService {
  /** The other leaves of the dock, drawer or sheet this instance is in, in layout order. */
  siblings(instanceId: string): PaneAttachment[];
  find(instanceId: string, kind: PaneKind): PaneAttachment | undefined;
  attach(instanceId: string, targetInstanceId: string, edge: PaneEdge): void;
  /** Moves the instance to a dock of its own, on the first edge with none. */
  detach(instanceId: string): void;
}
