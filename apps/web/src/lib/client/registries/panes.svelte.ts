import type {
	PaneAttachment,
	PaneDefinition,
	PaneEdge,
	PaneFrame,
	PaneInstance,
	PaneLayout,
	PaneRegistry,
} from '@nib-ui/ui-contracts';
import {
	insertAtEdge,
	insertBeside,
	leafNode,
	listLeaves,
	normalizeNode,
	removeLeaf,
	retainLeaves,
	setSizes,
	type NodePath,
} from '../layout/frames';
import { cascadeRect, clampRect, type Bounds, type WindowRect } from '../layout/windows';

/** The view the shell is built around: it fills the main area and is never a window. */
export const rootPaneId = 'canvas';

let sequence = 0;

function createId(prefix: string): string {
	sequence += 1;
	return `${prefix}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Params identify an instance — the same pane opened for two sessions is two
 * instances. Values are compared by identity, which is what a session id, a path
 * or a flag needs; an object literal rebuilt per call never matches.
 */
function sameParams(left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => Object.is(left[key], right[key]));
}

/**
 * Panes, the instances of them that are open, and the frames those float in.
 * Everything but the root pane opens over it, so the board stays whole
 * underneath: the frame list is the source of truth for what is on screen, and
 * its order is the stacking order.
 */
export class ReactivePaneRegistry implements PaneRegistry {
	definitions = $state<PaneDefinition[]>([]);
	openPanes = $state<PaneInstance[]>([]);
	frames = $state<PaneFrame[]>([]);
	bounds = $state<Bounds>({ width: 1280, height: 800 });
	focusedFrameId = $state<string | null>(null);
	focusedInstanceId = $state<string | null>(null);

	register(definition: PaneDefinition) {
		this.definitions = [...this.definitions, definition];
		return () => {
			// By id, not by identity: reading state hands back a proxy of the
			// definition, which is never the object the caller registered.
			this.definitions = this.definitions.filter((entry) => entry.id !== definition.id);
			this.close(definition.id);
		};
	}

	list(): PaneDefinition[] {
		return this.definitions;
	}

	definition(paneId: string): PaneDefinition | undefined {
		return this.definitions.find((entry) => entry.id === paneId);
	}

	instances(paneId?: string): PaneInstance[] {
		return paneId === undefined ? this.openPanes : this.openPanes.filter((entry) => entry.paneId === paneId);
	}

	instance(instanceId: string): PaneInstance | undefined {
		return this.openPanes.find((entry) => entry.instanceId === instanceId);
	}

	/** The instance and its definition, as a neighbour would want to read it. */
	attachment(instanceId: string): PaneAttachment | undefined {
		const instance = this.instance(instanceId);
		const definition = instance && this.definition(instance.paneId);
		if (!instance || !definition) return undefined;
		return {
			instanceId,
			paneId: instance.paneId,
			kind: definition.kind,
			title: definition.title,
			...(instance.params ? { params: instance.params } : {}),
		};
	}

	frameOf(instanceId: string): PaneFrame | undefined {
		return this.frames.find((frame) => listLeaves(frame.root).includes(instanceId));
	}

	frame(frameId: string): PaneFrame | undefined {
		return this.frames.find((entry) => entry.frameId === frameId);
	}

	open(paneId: string, params?: Record<string, unknown>): string {
		if (paneId === rootPaneId) {
			this.focusedFrameId = null;
			this.focusedInstanceId = null;
			return rootPaneId;
		}

		const candidates = this.instances(paneId);
		const existing = params === undefined ? candidates.at(-1) : candidates.findLast((entry) => sameParams(entry.params, params));
		if (!existing) return this.openInstance(paneId, params);

		this.raiseFrame(this.frameOf(existing.instanceId)?.frameId);
		this.focusedInstanceId = existing.instanceId;
		return existing.instanceId;
	}

	openInstance(paneId: string, params?: Record<string, unknown>): string {
		if (paneId === rootPaneId) return rootPaneId;
		const instanceId = createId('pane');
		this.openPanes = [...this.openPanes, { instanceId, paneId, ...(params ? { params } : {}) }];

		const frame: PaneFrame = {
			frameId: createId('frame'),
			rect: cascadeRect(
				this.frames.map((entry) => entry.rect),
				this.bounds,
			),
			root: leafNode(instanceId),
		};
		this.frames = [...this.frames, frame];
		this.focusedFrameId = frame.frameId;
		this.focusedInstanceId = instanceId;
		return instanceId;
	}

	/**
	 * Re-keys an open instance. What a pane shows can move under it — a
	 * conversation handed to another harness continues in a new session — and a
	 * neighbouring pane reads these params to tell what it is next to, so they
	 * follow the work rather than describe where it started.
	 */
	reparam(instanceId: string, params?: Record<string, unknown>): void {
		if (!this.isInstanceOpen(instanceId)) return;
		this.openPanes = this.openPanes.map((entry) =>
			entry.instanceId === instanceId ? { instanceId, paneId: entry.paneId, ...(params ? { params } : {}) } : entry,
		);
	}

	close(paneId: string): void {
		if (paneId === rootPaneId) return;
		for (const instance of this.instances(paneId)) this.closeInstance(instance.instanceId);
	}

	closeInstance(instanceId: string): void {
		const frame = this.frameOf(instanceId);
		this.openPanes = this.openPanes.filter((entry) => entry.instanceId !== instanceId);
		if (frame) {
			const root = removeLeaf(frame.root, instanceId);
			this.frames = root
				? this.frames.map((entry) => (entry.frameId === frame.frameId ? { ...entry, root } : entry))
				: this.frames.filter((entry) => entry.frameId !== frame.frameId);
		}
		if (this.focusedInstanceId === instanceId) this.focusTopmost();
	}

	toggle(paneId: string): void {
		if (this.isOpen(paneId)) this.close(paneId);
		else this.open(paneId);
	}

	isOpen(paneId: string): boolean {
		return paneId === rootPaneId || this.openPanes.some((entry) => entry.paneId === paneId);
	}

	isInstanceOpen(instanceId: string): boolean {
		return this.openPanes.some((entry) => entry.instanceId === instanceId);
	}

	/** Brings a frame to the front by making it the last one drawn. */
	raiseFrame(frameId: string | undefined): void {
		const frame = frameId ? this.frame(frameId) : undefined;
		if (!frame) return;
		this.focusedFrameId = frame.frameId;
		if (this.frames.at(-1) !== frame) this.frames = [...this.frames.filter((entry) => entry !== frame), frame];
	}

	focusInstance(instanceId: string): void {
		if (!this.isInstanceOpen(instanceId)) return;
		this.focusedInstanceId = instanceId;
		this.raiseFrame(this.frameOf(instanceId)?.frameId);
	}

	setFrameRect(frameId: string, rect: WindowRect): void {
		this.frames = this.frames.map((frame) =>
			frame.frameId === frameId ? { ...frame, rect: clampRect(rect, this.bounds) } : frame,
		);
	}

	setSplitSizes(frameId: string, path: NodePath, sizes: number[]): void {
		this.frames = this.frames.map((frame) =>
			frame.frameId === frameId ? { ...frame, root: setSizes(frame.root, path, sizes) } : frame,
		);
	}

	/** Makes the instance a sibling of another one, on the given side of it. */
	attach(instanceId: string, targetInstanceId: string, edge: PaneEdge): void {
		const target = this.frameOf(targetInstanceId);
		if (!target || instanceId === targetInstanceId) return;
		this.merge(instanceId, target.frameId, (root) => insertBeside(root, instanceId, targetInstanceId, edge));
	}

	/** Makes the instance the outermost child of a frame, against one of its edges. */
	attachToFrame(instanceId: string, frameId: string, edge: PaneEdge): void {
		const source = this.frameOf(instanceId);
		if (!source) return;
		if (source.frameId === frameId && listLeaves(source.root).length < 2) return;
		this.merge(instanceId, frameId, (root) => insertAtEdge(root, instanceId, edge));
	}

	private merge(instanceId: string, frameId: string, insert: (root: PaneFrame['root']) => PaneFrame['root']): void {
		const source = this.frameOf(instanceId);
		const target = this.frame(frameId);
		if (!source || !target) return;

		const sourceRoot = removeLeaf(source.root, instanceId);
		// Rearranging inside one frame: the tree the leaf goes back into is the one
		// it was just taken out of, not the stale root.
		const targetRoot = source.frameId === target.frameId ? sourceRoot : target.root;
		if (!targetRoot) return;
		const merged = insert(targetRoot);

		this.frames = this.frames.flatMap((frame) => {
			if (frame.frameId === target.frameId) return [{ ...frame, root: merged }];
			if (frame.frameId === source.frameId) return sourceRoot ? [{ ...frame, root: sourceRoot }] : [];
			return [frame];
		});
		this.focusedInstanceId = instanceId;
		this.raiseFrame(target.frameId);
	}

	/** Moves the instance out of a shared frame into one of its own. */
	detach(instanceId: string, at?: { x: number; y: number }): void {
		const source = this.frameOf(instanceId);
		if (!source || listLeaves(source.root).length < 2) return;
		const root = removeLeaf(source.root, instanceId);
		if (!root) return;

		const frame: PaneFrame = {
			frameId: createId('frame'),
			rect: clampRect(
				{
					x: at?.x ?? source.rect.x + 24,
					y: at?.y ?? source.rect.y + 24,
					width: source.rect.width,
					height: source.rect.height,
				},
				this.bounds,
			),
			root: leafNode(instanceId),
		};

		this.frames = [
			...this.frames.map((entry) => (entry.frameId === source.frameId ? { ...entry, root } : entry)),
			frame,
		];
		this.focusedFrameId = frame.frameId;
		this.focusedInstanceId = instanceId;
	}

	/** The main area was measured or resized; frames follow it rather than fall off it. */
	setBounds(bounds: Bounds): void {
		if (bounds.width === this.bounds.width && bounds.height === this.bounds.height) return;
		this.bounds = bounds;
		this.frames = this.frames.map((frame) => ({ ...frame, rect: clampRect(frame.rect, bounds) }));
	}

	/** Plain values, not state proxies: this is what gets written to the board. */
	snapshotLayout(): PaneLayout {
		return $state.snapshot({ frames: this.frames, instances: this.openPanes }) as PaneLayout;
	}

	/**
	 * Takes a stored layout as the current one. An instance whose pane no build
	 * provides is dropped — a frame that could only render an error is worse than
	 * a smaller layout — and the rest of the layout is kept.
	 */
	restoreLayout(layout: PaneLayout | undefined): void {
		const provided = new Set(this.definitions.map((entry) => entry.id));
		const known = new Map(
			(layout?.instances ?? [])
				.filter((entry) => entry.paneId !== rootPaneId && provided.has(entry.paneId))
				.map((entry) => [entry.instanceId, entry]),
		);

		const placed = new Set<string>();
		const frames: PaneFrame[] = [];
		for (const frame of layout?.frames ?? []) {
			const root = retainLeaves(frame.root, (instanceId) => known.has(instanceId) && !placed.has(instanceId));
			if (!root) continue;
			for (const instanceId of listLeaves(root)) placed.add(instanceId);
			frames.push({ frameId: frame.frameId, rect: clampRect(frame.rect, this.bounds), root: normalizeNode(root) });
		}

		this.frames = frames;
		this.openPanes = [...placed].map((instanceId) => known.get(instanceId)!);
		this.focusTopmost();
	}

	private focusTopmost(): void {
		const frame = this.frames.at(-1);
		this.focusedFrameId = frame?.frameId ?? null;
		this.focusedInstanceId = frame ? (listLeaves(frame.root).at(-1) ?? null) : null;
	}
}
