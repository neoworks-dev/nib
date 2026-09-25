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

/**
 * The loaded plugin's store, for the settings section: slot components are
 * handed a session, not the kernel.
 */
export const comfyPluginState = $state<{ store: ComfyStore | null; host: ComfyPaneHost | null }>({
  store: null,
  host: null,
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

  /** The library, with the project's workflows when `cwd` names one. */
  library(cwd: string | null): Promise<ComfyLibraryEntry[]> {
    return this.transport.comfyLibrary(cwd);
  }

  /** Runs a library workflow; the run arrives here as it progresses. */
  async runWorkflow(input: ComfyRunWorkflowInput): Promise<ComfyRun> {
    const run = await this.transport.runComfyWorkflow(input);
    this.receive(run);
    return run;
  }

  saveWorkflow(input: ComfySaveWorkflowInput): Promise<ComfyLibraryEntry> {
    return this.transport.saveComfyWorkflow(input);
  }

  deleteWorkflow(source: "user" | "project", id: string, cwd: string | null): Promise<void> {
    return this.transport.deleteComfyWorkflow(source, id, cwd);
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
