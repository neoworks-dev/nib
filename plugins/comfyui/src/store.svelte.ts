import type { Disposer } from "@nib-ui/kernel";
import type {
  ComfyNodeDefinitions,
  ComfyQueueInput,
  ComfyRun,
  ComfyService,
  ComfyStatus,
  TransportService,
} from "@nib-ui/ui-contracts";
import { upsertRun } from "./runs";

/**
 * The loaded plugin's store, for the settings section: slot components are
 * handed a session, not the kernel.
 */
export const comfyPluginState = $state<{ store: ComfyStore | null }>({ store: null });

/**
 * The `comfy` service: the server's runs mirrored into reactive state, and the
 * calls that change them. One per loaded plugin; `connect` ties it to a transport
 * and its disposer unties it.
 */
export class ComfyStore implements ComfyService {
  status = $state<ComfyStatus | null>(null);
  runs = $state<ComfyRun[]>([]);
  private readonly listeners = new Set<(run: ComfyRun) => void>();

  constructor(private readonly transport: TransportService) {}

  /** Starts mirroring the server's runs and reads the status once. */
  connect(): Disposer {
    const unsubscribe = this.transport.subscribeComfyRuns((run) => this.receive(run));
    void this.refreshStatus().catch(() => {});
    return () => {
      unsubscribe();
      this.listeners.clear();
    };
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
