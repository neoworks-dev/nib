import type { Disposer } from "@nib-ui/kernel";
import type {
  ComfyEditorRequest,
  ComfyLibraryEntry,
  ComfyNodeDefinitions,
  ComfyQueueInput,
  ComfyRun,
  ComfyRunWorkflowInput,
  ComfySaveWorkflowInput,
  ComfyService,
  ComfyStatus,
  PaneRegistry,
  TransportService,
} from "@nib-ui/ui-contracts";
import { upsertRun } from "./runs";

/** How old the composer's copy of the library may get before it is read again. */
const LIBRARY_STALE_MS = 15_000;

/**
 * The loaded plugin's store, for the settings section: slot components are
 * handed a session, not the kernel.
 */
export const comfyPluginState = $state<{
  store: ComfyStore | null;
  host: ComfyPaneHost | null;
  /** The last workflow asked to open in the editor; `serial` tells two requests for the same apart. */
  editorRequest: (ComfyEditorRequest & { serial: number }) | null;
}>({
  store: null,
  host: null,
  editorRequest: null,
});

/** What the plugin's panes need from the rest of the app, handed over by the plugin. */
export interface ComfyPaneHost {
  transport: TransportService;
  panes: PaneRegistry;
  /** The project whose board is on screen; empty before one is opened. */
  cwd(): string;
}

/**
 * The `comfy` service: the server's runs mirrored into reactive state, and the
 * calls that change them. One per loaded plugin; `connect` ties it to a transport
 * and its disposer unties it.
 */
export class ComfyStore implements ComfyService {
  status = $state<ComfyStatus | null>(null);
  runs = $state<ComfyRun[]>([]);
  /** The last library read per project, keyed by cwd; "" for none. */
  private libraries = $state<Record<string, { entries: ComfyLibraryEntry[]; readAt: number }>>({});
  /** Projects whose library is being read, so a render does not start a second read. */
  private readonly reading = new Set<string>();
  private readonly listeners = new Set<(run: ComfyRun) => void>();
  private readonly editorListeners = new Set<(request: ComfyEditorRequest) => void>();

  constructor(private readonly transport: TransportService) {}

  /** Starts mirroring the server's runs and reads the status once. */
  connect(): Disposer {
    const unsubscribe = this.transport.subscribeComfy(
      (run) => this.receive(run),
      (request) => this.announceEditorRequest(request),
    );
    void this.refreshStatus().catch(() => {});
    return () => {
      unsubscribe();
      this.listeners.clear();
      this.editorListeners.clear();
    };
  }

  /** The library, with the project's workflows when `cwd` names one. Read fresh, and kept for `cachedLibrary`. */
  async library(cwd: string | null): Promise<ComfyLibraryEntry[]> {
    const entries = await this.transport.comfyLibrary(cwd);
    this.libraries = { ...this.libraries, [cwd ?? ""]: { entries, readAt: Date.now() } };
    return entries;
  }

  /**
   * Reactive: the library as last read for this project, read again in the
   * background once it is older than `LIBRARY_STALE_MS` — for the composer,
   * which asks on every render and cannot wait. Empty until the first read.
   */
  cachedLibrary(cwd: string): ComfyLibraryEntry[] {
    const cached = this.libraries[cwd];
    const stale = !cached || Date.now() - cached.readAt > LIBRARY_STALE_MS;
    if (stale && !this.reading.has(cwd)) this.readInBackground(cwd);
    if (!cached) return [];
    return cached.entries;
  }

  /** Runs a library workflow; the run arrives here as it progresses. */
  async runWorkflow(input: ComfyRunWorkflowInput): Promise<ComfyRun> {
    const run = await this.transport.runComfyWorkflow(input);
    this.receive(run);
    return run;
  }

  async saveWorkflow(input: ComfySaveWorkflowInput): Promise<ComfyLibraryEntry> {
    const saved = await this.transport.saveComfyWorkflow(input);
    this.markLibrariesStale();
    return saved;
  }

  async deleteWorkflow(source: "user" | "project", id: string, cwd: string | null): Promise<void> {
    await this.transport.deleteComfyWorkflow(source, id, cwd);
    this.markLibrariesStale();
  }

  /** Has every cached library read again on its next use, keeping what it shows until then. */
  private markLibrariesStale(): void {
    const stale: typeof this.libraries = {};
    for (const [cwd, cached] of Object.entries(this.libraries)) {
      stale[cwd] = { entries: cached.entries, readAt: 0 };
    }
    this.libraries = stale;
  }

  /**
   * Reads a project's library off the render that asked: writing state while a
   * derivation runs is not allowed, so the read and the write are a tick later.
   */
  private readInBackground(cwd: string): void {
    this.reading.add(cwd);
    queueMicrotask(() => {
      this.library(cwd.length > 0 ? cwd : null)
        .catch(() => undefined)
        .finally(() => this.reading.delete(cwd));
    });
  }

  /**
   * Opens a workflow in the editor. It goes by way of the server, so a request
   * made here and one an agent makes arrive the same way.
   */
  openInEditor(request: ComfyEditorRequest): void {
    void this.transport.openComfyEditor(request).catch(() => {
      this.announceEditorRequest(request);
    });
  }

  subscribeEditorRequests(listener: (request: ComfyEditorRequest) => void): Disposer {
    this.editorListeners.add(listener);
    return () => this.editorListeners.delete(listener);
  }

  /** Hands an editor request to whoever shows the editor. */
  private announceEditorRequest(request: ComfyEditorRequest): void {
    for (const listener of this.editorListeners) listener(request);
  }

  /** Asks the server whether ComfyUI answers. */
  async refreshStatus(): Promise<ComfyStatus> {
    this.status = await this.transport.comfyStatus();
    return this.status;
  }

  /** Saves a new address. */
  async configure(baseUrl: string): Promise<ComfyStatus> {
    this.status = await this.transport.configureComfy(baseUrl);
    return this.status;
  }

  /** Node definitions, from the server's cache unless asked to refresh. */
  nodeDefinitions(options: { refresh?: boolean } = {}): Promise<ComfyNodeDefinitions> {
    return this.transport.comfyNodeDefinitions(options.refresh === true);
  }

  /** Queues a workflow; the run arrives here as it progresses. */
  async queue(input: ComfyQueueInput): Promise<ComfyRun> {
    const run = await this.transport.queueComfy(input);
    this.receive(run);
    return run;
  }

  /** Cancels a run. */
  cancel(runId: string): Promise<void> {
    return this.transport.cancelComfyRun(runId);
  }

  /** Calls the listener with each run as it changes. */
  subscribe(listener: (run: ComfyRun) => void): Disposer {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * One run from the server. The queue answer and the stream both carry the
   * queued run, and an older state never replaces a newer one.
   */
  private receive(run: ComfyRun): void {
    const known = this.runs.find((existing) => existing.id === run.id);
    if (known && known.status !== "queued" && run.status === "queued") return;
    this.runs = upsertRun(this.runs, run);
    for (const listener of this.listeners) listener(run);
  }
}
