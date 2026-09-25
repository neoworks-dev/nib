import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import type { Disposer, Plugin } from "@nib-ui/kernel";
import {
  type BoardDoc,
  type ComfyNodeDefinitions,
  type ComfyQueueInput,
  type ComfyResultSlot,
  type ComfyRun,
  type ComfyStatus,
  type ComfyWorkflow,
  DEFAULT_COMFY_URL,
} from "@nib-ui/ui-contracts";
import {
  ComfyApiError,
  ComfyClient,
  type ComfyEvent,
  type ComfyFile,
  type FetchImpl,
  normalizeBaseUrl,
  parseSocketMessage,
  socketUrl,
  withInputs,
} from "../comfyui";
import { createComfyTools } from "../comfy-agent-tools";
import { ComfyLibrary, userWorkflowDirectory } from "../comfyui-library";
import {
  applyEvent,
  cancelRun,
  failRun,
  isFinished,
  type QueuedRunDetails,
  queuedRun,
  succeedRun,
} from "../comfyui-runs";
import { lineageObjects, resultSlot, slotPlacements } from "../comfyui-slot";
import type { BoardService, ComfyUIService, VaultService } from "../services";
import { userConfigPath } from "../user-config";

/** Where a run's outputs land when neither the caller nor a reference picture names a directory. */
export const DEFAULT_OUTPUT_DIRECTORY = "comfyui";
/** Finished runs kept for the run list; older ones are forgotten. */
const MAX_RUNS = 200;
/** How long a queue waits for the socket before queueing without it. */
const CONNECT_TIMEOUT_MS = 5_000;
const RECONNECT_DELAY_MS = 2_000;
/** The history entry is written just after `execution_success`, so it is polled briefly. */
const HISTORY_ATTEMPTS = 20;
const HISTORY_INTERVAL_MS = 250;
/** Events for prompts not registered yet are held for this many prompts at most. */
const MAX_EARLY_PROMPTS = 64;

export interface SocketHandlers {
  open(): void;
  message(text: string): void;
  close(): void;
}

/** Opens a socket and reports on it; the handle only closes it. */
export type SocketFactory = (url: string, handlers: SocketHandlers) => { close(): void };

/** What the host needs from the world, so a test can hand over fakes. */
export interface ComfyHostOptions {
  vault: Pick<VaultService, "readFile" | "write">;
  /** Read to choose where a result goes, and written to put it there. */
  boards: Pick<BoardService, "read" | "place" | "addObjects">;
  settingsPath: string;
  fetchImpl: FetchImpl;
  openSocket: SocketFactory;
  reconnectDelayMs: number;
}

/** A run and what it takes to finish it. */
interface Tracked {
  run: ComfyRun;
  workflow: ComfyWorkflow;
  outputDirectory: string;
  /** The server it was queued on, which a later `configure` does not change. */
  client: ComfyClient;
  /** Saved files reported by `executed` events, in the order they arrived. */
  files: ComfyFile[];
  delivering: boolean;
}

/** The ComfyUI settings file, next to the user config. */
export function comfySettingsPath(): string {
  return join(dirname(userConfigPath()), "comfyui.json");
}

/** The browser's WebSocket, as Node and Bun both provide it, behind `SocketFactory`. */
export function openWebSocket(url: string, handlers: SocketHandlers): { close(): void } {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => handlers.open());
  socket.addEventListener("message", (event) => {
    // Binary frames are live previews of the image being sampled.
    if (typeof event.data === "string") handlers.message(event.data);
  });
  // An error is always followed by a close, which is where it is handled.
  socket.addEventListener("close", () => handlers.close());
  return { close: () => socket.close() };
}

/** The error message of anything thrown. */
function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * The vault directory a run's outputs go to: the one the caller named, else the
 * folder of the first picture it was given, so a result lands beside what it was
 * made from.
 */
function outputDirectoryFor(input: ComfyQueueInput): string {
  if (input.outputDirectory !== undefined) return input.outputDirectory;
  const reference = input.uploads?.[0];
  if (!reference) return DEFAULT_OUTPUT_DIRECTORY;
  const directory = posix.dirname(reference.path);
  if (directory === ".") return "";
  return directory;
}

/** What a queued run is shown as: the name the caller gave it, or null for a bare graph. */
function labelOf(input: ComfyQueueInput): string | null {
  if (input.label === undefined) return null;
  return input.label;
}

/** The vault paths of the pictures a run is given, in upload order. */
function inputPaths(input: ComfyQueueInput): string[] {
  if (!input.uploads) return [];
  return input.uploads.map((upload) => upload.path);
}

/** Waits the given time. */
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Follows every run the app queued over one socket, identified to ComfyUI by a
 * client id of its own, so the progress of other clients' runs never reaches it.
 */
export class ComfyHost implements ComfyUIService {
  private readonly clientId = randomUUID();
  private readonly tracked = new Map<string, Tracked>();
  private readonly listeners = new Set<(run: ComfyRun) => void>();
  /** Socket events that arrived before `POST /prompt` answered with their id. */
  private readonly early = new Map<string, ComfyEvent[]>();
  private current: ComfyClient | null = null;
  private nodeCache: ComfyNodeDefinitions | null = null;
  private socket: { close(): void } | null = null;
  private socketOpen: Promise<boolean> | null = null;
  /** Bumped whenever a socket is dropped, so its late events are told apart. */
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: ComfyHostOptions) {}

  /** Whether ComfyUI answers at the configured address. */
  async status(): Promise<ComfyStatus> {
    const client = await this.client();
    try {
      const version = await client.version();
      return { baseUrl: client.baseUrl, connected: true, version, error: null };
    } catch (cause) {
      return { baseUrl: client.baseUrl, connected: false, version: null, error: messageOf(cause) };
    }
  }

  /** Saves a new address and fails whatever was still running on the old one. */
  async configure(baseUrl: string): Promise<ComfyStatus> {
    const normalized = normalizeBaseUrl(baseUrl);
    await mkdir(dirname(this.options.settingsPath), { recursive: true });
    await writeFile(
      this.options.settingsPath,
      `${JSON.stringify({ baseUrl: normalized }, null, "\t")}\n`,
    );
    this.current = new ComfyClient(normalized, this.options.fetchImpl);
    this.nodeCache = null;
    this.dropSocket();
    for (const tracked of this.tracked.values()) {
      if (isFinished(tracked.run)) continue;
      this.update(
        tracked,
        failRun(tracked.run, "the ComfyUI address changed during the run", Date.now()),
      );
    }
    return this.status();
  }

  /** `/object_info`, from memory unless asked to fetch it again. */
  async nodeDefinitions(refresh: boolean): Promise<ComfyNodeDefinitions> {
    if (this.nodeCache && !refresh) return this.nodeCache;
    const client = await this.client();
    this.nodeCache = await client.nodeDefinitions();
    return this.nodeCache;
  }

  /** Uploads the inputs, queues the workflow and starts following it. */
  async queue(input: ComfyQueueInput): Promise<ComfyRun> {
    const client = await this.client();
    const assignments = await this.uploadInputs(client, input);
    const workflow = withInputs(input.workflow, assignments);
    const outputDirectory = outputDirectoryFor(input);
    const details: QueuedRunDetails = {
      label: labelOf(input),
      inputs: inputPaths(input),
      slot: await this.chooseSlot(input, outputDirectory),
    };
    await this.connectWithin(CONNECT_TIMEOUT_MS);
    const promptId = await client.queue(workflow, this.clientId);

    const tracked: Tracked = {
      run: queuedRun(promptId, input.cwd, Date.now(), details),
      workflow,
      outputDirectory,
      client,
      files: [],
      delivering: false,
    };
    this.tracked.set(promptId, tracked);
    this.forgetOldRuns();
    this.emit(tracked.run);
    this.replayEarly(tracked);
    return tracked.run;
  }

  /** Drops a run that has not started, or interrupts it if it has. */
  async cancel(runId: string): Promise<void> {
    const tracked = this.tracked.get(runId);
    if (!tracked) throw new ComfyApiError(`no run ${runId}`, 404);
    if (isFinished(tracked.run)) return;
    if (tracked.run.status === "queued") {
      await tracked.client.deleteQueued([runId]);
      this.update(tracked, cancelRun(tracked.run, Date.now()));
    }
    // Targeted: ComfyUI interrupts only if this prompt is the one executing, which
    // also covers a queued run that started between the check and the delete.
    await tracked.client.interrupt(runId);
  }

  /** Every run, newest first. */
  runs(): ComfyRun[] {
    const runs = [...this.tracked.values()].map((tracked) => tracked.run);
    return runs.sort((left, right) => right.queuedAt - left.queuedAt);
  }

  /** Calls the listener with each run as it changes. */
  subscribe(listener: (run: ComfyRun) => void): Disposer {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Closes the socket and stops reconnecting. */
  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.dropSocket();
    this.listeners.clear();
  }

  /** The client for the configured address, read from the settings file once. */
  private async client(): Promise<ComfyClient> {
    if (this.current) return this.current;
    let baseUrl = DEFAULT_COMFY_URL;
    try {
      const settings: { baseUrl?: unknown } = JSON.parse(
        await readFile(this.options.settingsPath, "utf8"),
      );
      if (typeof settings.baseUrl === "string") baseUrl = normalizeBaseUrl(settings.baseUrl);
    } catch {
      // No file, or one that does not parse: the default address it is.
    }
    this.current = new ComfyClient(baseUrl, this.options.fetchImpl);
    return this.current;
  }

  /** Uploads each vault file a node takes, answering with the names to write into it. */
  private async uploadInputs(
    client: ComfyClient,
    input: ComfyQueueInput,
  ): Promise<{ nodeId: string; input: string; value: string }[]> {
    const assignments: { nodeId: string; input: string; value: string }[] = [];
    if (!input.uploads) return assignments;
    for (const upload of input.uploads) {
      const file = await this.options.vault.readFile(input.cwd, upload.path);
      if (!file) throw new ComfyApiError(`cannot read ${upload.path} from the vault`, 400);
      const name = await client.upload(file.bytes, basename(upload.path), file.contentType);
      assignments.push({ nodeId: upload.nodeId, input: upload.input, value: name });
    }
    return assignments;
  }

  /**
   * Where the result will sit: beside the first input on the board the outputs
   * land on, clear of the spots held for runs still going. Null when the board
   * cannot be read — the run goes ahead, and the scan places its outputs.
   */
  private async chooseSlot(
    input: ComfyQueueInput,
    outputDirectory: string,
  ): Promise<ComfyResultSlot | null> {
    let board: BoardDoc;
    try {
      board = await this.options.boards.read(input.cwd);
    } catch {
      return null;
    }
    let reference: string | null = null;
    const first = input.uploads?.[0];
    if (first) reference = first.path;
    return resultSlot(board.placements, outputDirectory, reference, this.reservedSlots(input.cwd));
  }

  /** The spots held for this project's runs that have not finished. */
  private reservedSlots(cwd: string): ComfyResultSlot[] {
    const slots: ComfyResultSlot[] = [];
    for (const tracked of this.tracked.values()) {
      const { run } = tracked;
      if (run.cwd !== cwd || isFinished(run) || run.slot === null) continue;
      slots.push(run.slot);
    }
    return slots;
  }

  /** Opens the socket, giving up on waiting after a while; queueing goes ahead either way. */
  private async connectWithin(timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    await Promise.race([this.connect(), timeout]);
    clearTimeout(timer);
  }

  /**
   * The socket, opened if it is not. Resolves false when it closes before
   * opening, rather than rejecting: a reconnect nobody awaits must not surface
   * as an unhandled rejection.
   */
  private connect(): Promise<boolean> {
    if (this.socketOpen) return this.socketOpen;
    this.generation += 1;
    const generation = this.generation;
    this.socketOpen = this.client().then(
      (client) =>
        new Promise<boolean>((resolve) => {
          this.socket = this.options.openSocket(socketUrl(client.baseUrl, this.clientId), {
            open: () => {
              resolve(true);
              void this.reconcile();
            },
            message: (text) => {
              if (generation === this.generation) this.receive(text);
            },
            close: () => {
              resolve(false);
              this.socketClosed(generation);
            },
          });
        }),
    );
    return this.socketOpen;
  }

  /** Forgets a socket that closed, and comes back for the runs still in flight. */
  private socketClosed(generation: number): void {
    if (generation !== this.generation) return;
    this.socket = null;
    this.socketOpen = null;
    this.scheduleReconnect();
  }

  /** Closes the current socket without reconnecting it. */
  private dropSocket(): void {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    this.socketOpen = null;
    if (socket) socket.close();
  }

  /** Tries the socket again later, as long as a run is waiting on it. */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const waiting = [...this.tracked.values()].some((tracked) => !isFinished(tracked.run));
    if (!waiting) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.options.reconnectDelayMs);
  }

  /**
   * Settles the runs whose ending the socket may have missed while it was down,
   * from ComfyUI's history.
   */
  private async reconcile(): Promise<void> {
    for (const tracked of this.tracked.values()) {
      if (isFinished(tracked.run) || tracked.delivering) continue;
      try {
        const history = await tracked.client.history(tracked.run.id);
        if (history.status === "success") void this.deliver(tracked, history.outputs);
        if (history.status === "error") {
          let message = "the workflow failed";
          if (history.errorMessage) message = history.errorMessage;
          this.update(tracked, failRun(tracked.run, message, Date.now()));
        }
      } catch {
        // Still unreachable; the next reconnect tries again.
      }
    }
  }

  /** One socket message, applied to the run it is about. */
  private receive(text: string): void {
    const event = parseSocketMessage(text);
    if (!event) return;
    const tracked = this.tracked.get(event.promptId);
    if (!tracked) {
      this.holdEarly(event);
      return;
    }
    this.handle(tracked, event);
  }

  /** Applies an event, and delivers the outputs once the run has succeeded. */
  private handle(tracked: Tracked, event: ComfyEvent): void {
    if (event.type === "executed") tracked.files.push(...event.files);
    this.update(tracked, applyEvent(tracked.run, event, tracked.workflow, Date.now()));
    if (event.type === "execution_success") void this.deliver(tracked, tracked.files);
  }

  /** Keeps an event for a prompt whose id the queue call has not returned yet. */
  private holdEarly(event: ComfyEvent): void {
    const held = this.early.get(event.promptId);
    if (held) {
      held.push(event);
      return;
    }
    if (this.early.size >= MAX_EARLY_PROMPTS) {
      const oldest = this.early.keys().next().value;
      if (oldest !== undefined) this.early.delete(oldest);
    }
    this.early.set(event.promptId, [event]);
  }

  /** Applies whatever arrived for a run before it was registered. */
  private replayEarly(tracked: Tracked): void {
    const held = this.early.get(tracked.run.id);
    if (!held) return;
    this.early.delete(tracked.run.id);
    for (const event of held) this.handle(tracked, event);
  }

  /** Downloads a succeeded run's files into the vault, then marks it succeeded. */
  private async deliver(tracked: Tracked, files: ComfyFile[]): Promise<void> {
    if (tracked.delivering || isFinished(tracked.run)) return;
    tracked.delivering = true;
    try {
      let saved = files;
      if (saved.length === 0) saved = await this.historyFiles(tracked);
      const paths: string[] = [];
      for (const file of saved) paths.push(await this.writeOutput(tracked, file));
      await this.placeOutputs(tracked.run, paths);
      await this.linkOutputs(tracked.run, paths);
      this.update(tracked, succeedRun(tracked.run, paths, Date.now()));
    } catch (cause) {
      this.update(tracked, failRun(tracked.run, messageOf(cause), Date.now()));
    } finally {
      tracked.delivering = false;
    }
  }

  /** The saved files from history, polled until ComfyUI has written the entry. */
  private async historyFiles(tracked: Tracked): Promise<ComfyFile[]> {
    for (let attempt = 0; attempt < HISTORY_ATTEMPTS; attempt += 1) {
      const history = await tracked.client.history(tracked.run.id);
      if (history.status !== "pending") return history.outputs;
      await sleep(HISTORY_INTERVAL_MS);
    }
    return [];
  }

  /** One output file into the vault, answering with where it landed. */
  private async writeOutput(tracked: Tracked, file: ComfyFile): Promise<string> {
    const bytes = await tracked.client.download(file);
    const written = await this.options.vault.write(
      tracked.run.cwd,
      tracked.outputDirectory,
      file.filename,
      bytes,
    );
    return written.path;
  }

  /**
   * Puts the outputs where the run's placeholder stood. A board that cannot be
   * written costs only the spot: the files are in the vault, and the scan places
   * them wherever the board has room.
   */
  private async placeOutputs(run: ComfyRun, paths: string[]): Promise<void> {
    if (run.slot === null || paths.length === 0) return;
    try {
      await this.options.boards.place(run.cwd, slotPlacements(run.slot, paths));
    } catch {
      // Placed by the scan instead; see above.
    }
  }

  /**
   * Ties the outputs to the pictures they were made from, as board objects the
   * canvas draws as lines. A board that cannot be written costs only the lines.
   */
  private async linkOutputs(run: ComfyRun, paths: string[]): Promise<void> {
    const links = lineageObjects(run, paths);
    if (links.length === 0) return;
    try {
      await this.options.boards.addObjects(run.cwd, links);
    } catch {
      // Drawn without the lines; the files and their placement are unaffected.
    }
  }

  /** Records a run's new state and tells the listeners, if it changed. */
  private update(tracked: Tracked, run: ComfyRun): void {
    if (run === tracked.run) return;
    tracked.run = run;
    this.emit(run);
  }

  /** Tells every listener about a run. */
  private emit(run: ComfyRun): void {
    for (const listener of this.listeners) listener(run);
  }

  /** Forgets the oldest finished runs past the cap. */
  private forgetOldRuns(): void {
    if (this.tracked.size <= MAX_RUNS) return;
    for (const [id, tracked] of this.tracked) {
      if (this.tracked.size <= MAX_RUNS) return;
      if (isFinished(tracked.run)) this.tracked.delete(id);
    }
  }
}

export const comfyuiPlugin: Plugin = {
  name: "comfyui",
  inject: ["vault", "boards"],
  apply(ctx) {
    const host = new ComfyHost({
      vault: ctx.require("vault"),
      boards: ctx.require("boards"),
      settingsPath: comfySettingsPath(),
      fetchImpl: fetch,
      openSocket: openWebSocket,
      reconnectDelayMs: RECONNECT_DELAY_MS,
    });
    ctx.provide("comfyui", host);
    ctx.effect(() => () => host.dispose());
  },
};

/** Hands every agent the ComfyUI tools, bound to its own project. */
export const comfyAgentToolsPlugin: Plugin = {
  name: "comfy-agent-tools",
  inject: ["agentControl", "comfyui", "comfyWorkflows"],
  apply(ctx) {
    const services = { comfyui: ctx.require("comfyui"), library: ctx.require("comfyWorkflows") };
    ctx.effect(() =>
      ctx
        .require("agentControl")
        .addToolSource(({ requireCwd }) => createComfyTools(services, requireCwd)),
    );
  },
};

/** The workflow library, on top of the ComfyUI host it queues through. */
export const comfyWorkflowsPlugin: Plugin = {
  name: "comfy-workflows",
  inject: ["comfyui", "vault"],
  apply(ctx) {
    ctx.provide(
      "comfyWorkflows",
      new ComfyLibrary({
        comfyui: ctx.require("comfyui"),
        vault: ctx.require("vault"),
        userDirectory: userWorkflowDirectory(),
      }),
    );
  },
};
