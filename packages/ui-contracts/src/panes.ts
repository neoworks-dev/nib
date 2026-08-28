import type { Component } from 'svelte';
import type { Disposer } from '@nib-ui/kernel';
import type { SessionView } from '@nib-ui/protocol';

/**
 * What a pane is, rather than which plugin happens to provide it. Another plugin
 * matches on it to find what it is sitting next to, so an unknown value is legal:
 * a plugin can introduce a kind without this list changing.
 */
export type KnownPaneKind =
	| 'canvas'
	| 'chat'
	| 'desktop'
	| 'editor'
	| 'explorer'
	| 'browser'
	| 'git'
	| 'tasks'
	| 'model'
	| 'settings'
	| 'terminal';

export type PaneKind = KnownPaneKind | (string & {});

/** One open copy of a pane: the same definition can be open several times over. */
export interface PaneInstance {
	instanceId: string;
	paneId: string;
	params?: Record<string, unknown>;
}

/** Structurally the app's `WindowRect`; contracts cannot import from the app. */
export interface PaneRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type PaneAxis = 'row' | 'column';

export type PaneEdge = 'left' | 'right' | 'top' | 'bottom';

/** `sizes` are fractions of the split's extent and sum to 1, one per child. */
export type PaneNode =
	| { kind: 'leaf'; instanceId: string }
	| { kind: 'split'; axis: PaneAxis; children: PaneNode[]; sizes: number[] };

/** A floating window: where it floats, and the tree of instances inside it. */
export interface PaneFrame {
	frameId: string;
	rect: PaneRect;
	root: PaneNode;
}

/** Frame order is the stacking order, last on top. */
export interface PaneLayout {
	frames: PaneFrame[];
	instances: PaneInstance[];
}

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
	component: Component<PaneProps>;
}

/**
 * Panes tile the main area. A plugin contributes a definition and asks for it to
 * be shown; where it lands in the layout is the user's business, not the plugin's.
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
	/** The other leaves of the frame this instance is in, in layout order. */
	siblings(instanceId: string): PaneAttachment[];
	find(instanceId: string, kind: PaneKind): PaneAttachment | undefined;
	attach(instanceId: string, targetInstanceId: string, edge: PaneEdge): void;
	/** Moves the instance out of its frame into one of its own. */
	detach(instanceId: string): void;
}
