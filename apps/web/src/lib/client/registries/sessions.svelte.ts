import type { Disposer } from "@nib-ui/kernel";
import {
  type AnyAgentEvent,
  createSessionView,
  type HarnessDescriptor,
  type MessageAttachment,
  type PermissionBehavior,
  reduceSession,
  type SessionCommand,
  type SessionView,
} from "@nib-ui/protocol";
import type {
  CreateSessionInput,
  DirectoryEntry,
  SessionSummary,
  SessionsService,
  TransportService,
} from "@nib-ui/ui-contracts";
import { loadRecentDirectories, rememberDirectory } from "../recent-directories";

/**
 * The browser-side projection: every open session is a `reduceSession` fold over
 * the transport stream, and the raw log is kept alongside it for the trajectory
 * inspector.
 */
export class ReactiveSessionsStore implements SessionsService {
  harnesses = $state<HarnessDescriptor[]>([]);
  activeId = $state<string | null>(null);
  error = $state<string | null>(null);
  recentDirectories = $state<string[]>(loadRecentDirectories());
  private history = $state<string[]>([]);
  private historyIndex = $state(-1);
  private fetched = $state<SessionSummary[]>([]);
  private lastEventAt = $state<Record<string, number>>({});
  private views = $state<Record<string, SessionView>>({});
  private logs = $state<Record<string, AnyAgentEvent[]>>({});
  private readonly subscriptions = new Map<string, Disposer>();

  constructor(private readonly transport: TransportService) {}

  /**
   * The list endpoint is a snapshot; a subscribed session's own event stream is
   * ahead of it. Folding the live projection back over the snapshot is what
   * keeps a task's status and age moving in the sidebar between refreshes.
   */
  get summaries(): SessionSummary[] {
    return this.fetched.map((summary) => {
      const view = this.views[summary.id];
      if (!view || view.lastSeq <= summary.lastSeq) return summary;
      return {
        ...summary,
        title: view.title ?? summary.title,
        status: view.status,
        model: view.model ?? summary.model,
        archived: view.archived,
        nativeSessionId: view.nativeSessionId ?? summary.nativeSessionId,
        lastSeq: view.lastSeq,
        updatedAt: this.lastEventAt[summary.id] ?? summary.updatedAt,
      };
    });
  }

  get active(): SessionView | null {
    return this.activeId ? (this.views[this.activeId] ?? null) : null;
  }

  events(sessionId: string): AnyAgentEvent[] {
    return this.logs[sessionId] ?? [];
  }

  view(sessionId: string): SessionView | null {
    return this.views[sessionId] ?? null;
  }

  async refresh(): Promise<void> {
    const [harnesses, summaries] = await Promise.all([
      this.transport.listHarnesses(),
      this.transport.listSessions(),
    ]);
    this.harnesses = harnesses;
    this.fetched = summaries;
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
    if (this.activeId !== sessionId) {
      // Opening from anywhere but the tail of the history truncates the forward branch.
      this.history = [...this.history.slice(0, this.historyIndex + 1), sessionId];
      this.historyIndex = this.history.length - 1;
    }
    this.activeId = sessionId;
    this.watch(sessionId);
  }

  get canGoBack(): boolean {
    return this.historyIndex > 0;
  }

  get canGoForward(): boolean {
    return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
  }

  back(): void {
    if (this.canGoBack) this.travel(this.historyIndex - 1);
  }

  forward(): void {
    if (this.canGoForward) this.travel(this.historyIndex + 1);
  }

  /** Moves the cursor without rewriting history, unlike `open`. */
  private travel(index: number): void {
    this.historyIndex = index;
    const sessionId = this.history[index]!;
    this.activeId = sessionId;
    this.watch(sessionId);
  }

  watch(sessionId: string): void {
    if (this.subscriptions.has(sessionId)) return;
    this.views[sessionId] ??= createSessionView(sessionId);
    this.logs[sessionId] ??= [];
    const fromSeq = this.views[sessionId]?.lastSeq ?? 0;
    this.subscriptions.set(
      sessionId,
      this.transport.subscribe(sessionId, fromSeq, (event) => this.apply(sessionId, event)),
    );
  }

  send(text: string, attachments?: MessageAttachment[]) {
    return this.dispatch({
      type: "session.send",
      text,
      ...(attachments?.length && { attachments }),
    });
  }

  sendTo(sessionId: string, text: string, attachments?: MessageAttachment[]) {
    return this.dispatchTo(sessionId, {
      type: "session.send",
      text,
      ...(attachments?.length && { attachments }),
    });
  }

  interrupt() {
    return this.dispatch({ type: "session.interrupt" });
  }

  respondToPermission(requestId: string, behavior: PermissionBehavior, updatedInput?: unknown) {
    return this.dispatch({ type: "session.permission.respond", requestId, behavior, updatedInput });
  }

  setPermissionMode(mode: string) {
    return this.dispatch({ type: "session.setPermissionMode", mode });
  }

  setModel(model: string) {
    return this.dispatch({ type: "session.setModel", model });
  }

  setEffort(effort: string) {
    return this.dispatch({ type: "session.setEffort", effort });
  }

  rewind(sessionId: string, messageId: string) {
    return this.dispatchTo(sessionId, { type: "session.rewind", messageId });
  }

  setLabel(label: string) {
    return this.dispatch({ type: "session.setLabel", label });
  }

  /** Scoped to the active session; the server resolves its working directory. */
  async searchFiles(query: string, limit?: number): Promise<string[]> {
    const sessionId = this.activeId;
    if (!sessionId) return [];
    try {
      return await this.transport.searchFiles(sessionId, query, limit);
    } catch {
      return [];
    }
  }

  listDirectories(path: string): Promise<{ base: string; entries: DirectoryEntry[] }> {
    return this.transport.listDirectories(path);
  }

  async resume(sessionId: string): Promise<void> {
    this.watch(sessionId);
    await this.dispatchTo(sessionId, { type: "session.resume" });
    await this.refresh();
  }

  rename(sessionId: string, label: string): Promise<void> {
    return this.dispatchTo(sessionId, { type: "session.setLabel", label });
  }

  async setArchived(sessionId: string, archived: boolean): Promise<void> {
    // The flag rides the session's own log, so it needs a subscription to land.
    this.watch(sessionId);
    await this.dispatchTo(sessionId, { type: "session.setArchived", archived });
    await this.refresh();
  }

  /** Stops the harness process; the transcript stays listable and resumable. */
  async close(sessionId: string): Promise<void> {
    await this.dispatchTo(sessionId, { type: "session.close" });
    await this.refresh();
  }

  async remove(sessionId: string): Promise<void> {
    this.error = null;
    try {
      await this.transport.deleteSession(sessionId);
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      return;
    }
    this.unwatch(sessionId);
    const before = this.history.slice(0, this.historyIndex + 1).filter((id) => id !== sessionId);
    this.history = [
      ...before,
      ...this.history.slice(this.historyIndex + 1).filter((id) => id !== sessionId),
    ];
    this.historyIndex = before.length - 1;
    if (this.activeId === sessionId) this.activeId = null;
    await this.refresh();
  }

  /**
   * Sessions nobody is subscribed to still change — another window, or a
   * harness finishing a turn after a reload — so the list is re-read on a timer
   * and whenever the tab comes back to the foreground.
   */
  startPolling(intervalMs = 5_000): Disposer {
    const tick = () => {
      if (document.visibilityState === "visible") void this.refresh();
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }

  disposeAll(): void {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
  }

  private unwatch(sessionId: string): void {
    this.subscriptions.get(sessionId)?.();
    this.subscriptions.delete(sessionId);
  }

  private apply(sessionId: string, event: AnyAgentEvent): void {
    const previous = this.views[sessionId] ?? createSessionView(sessionId);
    const next = reduceSession(previous, event);
    if (next === previous) return;
    this.views = { ...this.views, [sessionId]: next };
    this.logs = { ...this.logs, [sessionId]: [...(this.logs[sessionId] ?? []), event] };
    this.lastEventAt = { ...this.lastEventAt, [sessionId]: event.ts };
  }

  private dispatch(command: SessionCommand): Promise<void> {
    const sessionId = this.activeId;
    if (!sessionId) throw new Error("no active session");
    return this.dispatchTo(sessionId, command);
  }

  private async dispatchTo(sessionId: string, command: SessionCommand): Promise<void> {
    this.error = null;
    // The host reattaches a detached task to run the command, so the snapshot's
    // idea of which sessions have a process is exactly what the command invalidates.
    const wasDetached = this.fetched.some((summary) => summary.id === sessionId && !summary.live);
    try {
      await this.transport.command(sessionId, command);
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      return;
    }
    if (wasDetached) await this.refresh();
  }
}
