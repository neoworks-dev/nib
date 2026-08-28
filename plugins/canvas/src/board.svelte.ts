import type { Disposer } from '@nib-ui/kernel';
import { emptyBoard, type BoardDoc, type CanvasObject, type PaneLayout, type TransportService } from '@nib-ui/ui-contracts';
import * as ops from './board-ops';

export const SAVE_DEBOUNCE_MS = 500;
const HISTORY_LIMIT = 100;

/**
 * The board for one working directory: the objects, their persistence, and the
 * undo stack over them. Camera and selection are per-window and live in the
 * registry, not here.
 */
export class BoardStore {
	transport = $state<TransportService | null>(null);
	doc = $state<BoardDoc>(emptyBoard(''));
	/** False until the server's board for the current directory has arrived. */
	loaded = $state(false);
	/** Revision the server has confirmed; a write is `confirmedRev + 1`. */
	private confirmedRev = 0;
	private removedSinceConfirm: string[] = [];
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private saving: Promise<void> | null = null;
	private pending = false;
	private stream: Disposer | null = null;
	private opening: { cwd: string; done: Promise<void> } | null = null;
	private past: CanvasObject[][] = [];
	private future: CanvasObject[][] = [];
	private historyDepth = 0;
	private historyBase: CanvasObject[] | null = null;

	get objects(): CanvasObject[] {
		return this.doc.objects;
	}

	get cwd(): string {
		return this.doc.cwd;
	}

	get layout(): PaneLayout | undefined {
		return this.doc.layout;
	}

	/** Pane furniture, not board content: it is saved but never undone. */
	setLayout(layout: PaneLayout): void {
		const next = layout.frames.length > 0 ? layout : undefined;
		if (JSON.stringify(this.doc.layout ?? null) === JSON.stringify(next ?? null)) return;
		this.doc = { ...this.doc, layout: next };
		this.scheduleSave();
	}

	/**
	 * Re-entrant on purpose: the caller is a reactive effect, and opening writes
	 * `doc` before the load resolves. Without collapsing concurrent calls onto one
	 * promise, every write would re-enter this and start the fetch again.
	 */
	open(cwd: string): Promise<void> {
		if (this.opening?.cwd === cwd) return this.opening.done;
		if (this.doc.cwd === cwd && this.stream) return Promise.resolve();

		this.close();
		const transport = this.transport;
		this.doc = emptyBoard(cwd);
		this.confirmedRev = 0;
		if (!transport) return Promise.resolve();

		const done = transport
			.loadBoard(cwd)
			.then((loaded) => {
				// A board opened while this one was loading must not be overwritten by it.
				if (this.opening?.cwd !== cwd) return;
				this.doc = loaded;
				this.confirmedRev = loaded.rev;
				this.loaded = true;
				this.stream = transport.subscribeBoard(cwd, loaded.rev, (board) => this.applyRemote(board));
			})
			.finally(() => {
				if (this.opening?.cwd === cwd) this.opening = null;
			});

		this.opening = { cwd, done };
		return done;
	}

	close(): void {
		this.stream?.();
		this.stream = null;
		this.opening = null;
		this.loaded = false;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		this.pending = false;
		this.removedSinceConfirm = [];
		this.past = [];
		this.future = [];
		this.historyDepth = 0;
		this.historyBase = null;
	}

	find(id: string): CanvasObject | null {
		return this.doc.objects.find((object) => object.id === id) ?? null;
	}

	addObject(object: CanvasObject): void {
		const objects = ops.addObject(this.doc.objects, object);
		if (objects !== this.doc.objects) this.mutate(objects);
	}

	updateObject(id: string, patch: Partial<CanvasObject>): void {
		const objects = ops.updateObject(this.doc.objects, id, patch);
		if (objects !== this.doc.objects) this.mutate(objects);
	}

	removeObjects(ids: string[]): void {
		if (ids.length === 0) return;
		this.removedSinceConfirm.push(...ops.withCascade(this.doc.objects, ids));
		this.mutate(ops.removeObjects(this.doc.objects, ids));
	}

	/**
	 * Groups a gesture into one undo entry. Nested calls share the outermost
	 * snapshot, so a tool that resizes inside a drag does not push two.
	 */
	beginHistory(): Disposer {
		if (this.historyDepth === 0) this.historyBase = this.snapshot();
		this.historyDepth += 1;
		let closed = false;

		return () => {
			if (closed) return;
			closed = true;
			this.historyDepth -= 1;
			if (this.historyDepth > 0) return;
			const base = this.historyBase;
			this.historyBase = null;
			if (base && JSON.stringify(base) !== JSON.stringify(this.doc.objects)) this.pushHistory(base);
		};
	}

	undo(): void {
		const previous = this.past.pop();
		if (!previous) return;
		this.future.push(this.snapshot());
		this.doc = { ...this.doc, objects: previous };
		this.scheduleSave();
	}

	redo(): void {
		const next = this.future.pop();
		if (!next) return;
		this.past.push(this.snapshot());
		this.doc = { ...this.doc, objects: next };
		this.scheduleSave();
	}

	/** Waits out the debounce and any in-flight write — the tests' join point. */
	async flush(): Promise<void> {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
			void this.save();
		}
		while (this.saving) await this.saving;
	}

	private mutate(objects: CanvasObject[]): void {
		// A gesture in progress owns the snapshot; a lone mutation is its own entry.
		if (this.historyDepth === 0) this.pushHistory(this.snapshot());
		this.doc = { ...this.doc, objects };
		this.scheduleSave();
	}

	/**
	 * `structuredClone` cannot copy a Svelte state proxy, and the undo stack has to
	 * hold values rather than live references into the board.
	 */
	private snapshot(): CanvasObject[] {
		return $state.snapshot(this.doc.objects) as CanvasObject[];
	}

	private pushHistory(snapshot: CanvasObject[]): void {
		this.past.push(snapshot);
		if (this.past.length > HISTORY_LIMIT) this.past.shift();
		this.future = [];
	}

	private scheduleSave(): void {
		if (!this.transport || this.doc.cwd.length === 0) return;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.save();
		}, SAVE_DEBOUNCE_MS);
	}

	private async save(): Promise<void> {
		if (this.saving) {
			// A write is already in flight against this revision; queue behind it.
			this.pending = true;
			return;
		}

		const transport = this.transport;
		if (!transport) return;
		const cwd = this.doc.cwd;
		const objects = this.doc.objects;
		const layout = this.doc.layout;

		this.saving = (async () => {
			try {
				const stored = await transport.saveBoard({ version: 1, rev: this.confirmedRev + 1, cwd, objects, layout });
				if (this.doc.cwd !== cwd) return;
				this.confirmedRev = stored.rev;
				this.removedSinceConfirm = [];
				this.doc = { ...this.doc, rev: stored.rev };
			} catch {
				// Another window wrote first. Take its board as the base, keep what this
				// window changed on top, and let the retry carry the merge back.
				const server = await transport.loadBoard(cwd).catch(() => null);
				if (!server || this.doc.cwd !== cwd) return;
				this.confirmedRev = server.rev;
				this.doc = {
					...server,
					objects: ops.rebaseObjects(server.objects, this.doc.objects, this.removedSinceConfirm),
					// The layout is where this window put its panes; another window's
					// board does not get to rearrange them under the user.
					layout: this.doc.layout ?? server.layout,
				};
				this.pending = true;
			}
		})().finally(() => {
			this.saving = null;
			if (!this.pending) return;
			this.pending = false;
			this.scheduleSave();
		});

		await this.saving;
	}

	/**
	 * A board pushed by the server. Its own writes come back too, and are dropped
	 * by revision; a newer one from another window is rebased over whatever this
	 * window has not saved yet.
	 */
	private applyRemote(board: BoardDoc): void {
		if (board.cwd !== this.doc.cwd || board.rev <= this.confirmedRev) return;
		this.confirmedRev = board.rev;

		// The layout is this window's own view of the workspace: it is taken from the
		// board when one is opened, and after that only written, never pushed back.
		const layout = this.doc.layout ?? board.layout;

		if (this.saveTimer || this.saving) {
			this.doc = {
				...board,
				objects: ops.rebaseObjects(board.objects, this.doc.objects, this.removedSinceConfirm),
				layout,
			};
			this.scheduleSave();
			return;
		}
		this.removedSinceConfirm = [];
		this.doc = { ...board, layout };
	}
}
