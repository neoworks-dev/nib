import type { Disposer } from '@nib-ui/kernel';
import {
	createSessionView,
	reduceSession,
	type AnyAgentEvent,
	type HarnessDescriptor,
	type PermissionBehavior,
	type SessionCommand,
	type SessionView,
} from '@nib-ui/protocol';
import type {
	CreateSessionInput,
	DirectoryEntry,
	SessionSummary,
	SessionsService,
	TransportService,
} from '@nib-ui/ui-contracts';
import { loadRecentDirectories, rememberDirectory } from '../recent-directories';

/**
 * The browser-side projection: every open session is a `reduceSession` fold over
 * the transport stream, and the raw log is kept alongside it for the trajectory
 * inspector.
 */
export class ReactiveSessionsStore implements SessionsService {
	harnesses = $state<HarnessDescriptor[]>([]);
	summaries = $state<SessionSummary[]>([]);
	activeId = $state<string | null>(null);
	error = $state<string | null>(null);
	recentDirectories = $state<string[]>(loadRecentDirectories());
	private views = $state<Record<string, SessionView>>({});
	private logs = $state<Record<string, AnyAgentEvent[]>>({});
	private readonly subscriptions = new Map<string, Disposer>();

	constructor(private readonly transport: TransportService) {}

	get active(): SessionView | null {
		return this.activeId ? (this.views[this.activeId] ?? null) : null;
	}

	events(sessionId: string): AnyAgentEvent[] {
		return this.logs[sessionId] ?? [];
	}

	async refresh(): Promise<void> {
		const [harnesses, summaries] = await Promise.all([
			this.transport.listHarnesses(),
			this.transport.listSessions(),
		]);
		this.harnesses = harnesses;
		this.summaries = summaries;
	}

	async create(input: CreateSessionInput): Promise<void> {
		this.error = null;
		try {
			const sessionId = await this.transport.createSession(input);
			this.recentDirectories = rememberDirectory(this.recentDirectories, input.cwd);
			this.open(sessionId);
			await this.refresh();
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	open(sessionId: string): void {
		this.activeId = sessionId;
		if (this.subscriptions.has(sessionId)) return;
		this.views[sessionId] ??= createSessionView(sessionId);
		this.logs[sessionId] ??= [];
		const fromSeq = this.views[sessionId]?.lastSeq ?? 0;
		this.subscriptions.set(
			sessionId,
			this.transport.subscribe(sessionId, fromSeq, (event) => this.apply(sessionId, event)),
		);
	}

	send(text: string) {
		return this.dispatch({ type: 'session.send', text });
	}

	interrupt() {
		return this.dispatch({ type: 'session.interrupt' });
	}

	respondToPermission(requestId: string, behavior: PermissionBehavior) {
		return this.dispatch({ type: 'session.permission.respond', requestId, behavior });
	}

	setPermissionMode(mode: string) {
		return this.dispatch({ type: 'session.setPermissionMode', mode });
	}

	setModel(model: string) {
		return this.dispatch({ type: 'session.setModel', model });
	}

	setLabel(label: string) {
		return this.dispatch({ type: 'session.setLabel', label });
	}

	/** Scoped to the active session's cwd; without one there is nothing to search. */
	async searchFiles(query: string, limit?: number): Promise<string[]> {
		const cwd = this.active?.cwd;
		if (!cwd) return [];
		try {
			return await this.transport.searchFiles(cwd, query, limit);
		} catch {
			return [];
		}
	}

	listDirectories(path: string): Promise<{ base: string; entries: DirectoryEntry[] }> {
		return this.transport.listDirectories(path);
	}

	async close(sessionId: string): Promise<void> {
		await this.transport.command(sessionId, { type: 'session.close' });
		this.subscriptions.get(sessionId)?.();
		this.subscriptions.delete(sessionId);
		if (this.activeId === sessionId) this.activeId = null;
		await this.refresh();
	}

	disposeAll(): void {
		for (const unsubscribe of this.subscriptions.values()) unsubscribe();
		this.subscriptions.clear();
	}

	private apply(sessionId: string, event: AnyAgentEvent): void {
		const previous = this.views[sessionId] ?? createSessionView(sessionId);
		const next = reduceSession(previous, event);
		if (next === previous) return;
		this.views = { ...this.views, [sessionId]: next };
		this.logs = { ...this.logs, [sessionId]: [...(this.logs[sessionId] ?? []), event] };
	}

	private async dispatch(command: SessionCommand): Promise<void> {
		const sessionId = this.activeId;
		if (!sessionId) throw new Error('no active session');
		this.error = null;
		try {
			await this.transport.command(sessionId, command);
		} catch (cause) {
			this.error = cause instanceof Error ? cause.message : String(cause);
		}
	}
}
