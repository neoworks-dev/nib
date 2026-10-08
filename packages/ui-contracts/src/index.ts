import type { Disposer } from "@nib-ui/kernel";
import type {
  AnyAgentEvent,
  BlockKind,
  BlockView,
  HarnessDescriptor,
  MessageAttachment,
  MessageView,
  ModelInfo,
  PermissionBehavior,
  PermissionRequestView,
  SessionCommand,
  SessionDigest,
  SessionView,
} from "@nib-ui/protocol";
import type { Component } from "svelte";
import type { TrashEntry, VaultDoc } from "@nib-ui/vault";
import type { BoardDoc, BoardSummary, BoardWrite, CanvasRegistry } from "./canvas";
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
} from "./comfyui";
import type { ComposerTargetRegistry } from "./composer";
import type { DesktopAgentService } from "./desktop-agent";
import type { AttachmentsService, PaneRegistry } from "./panes";

export interface SessionSummary {
  id: string;
  harnessId: string;
  cwd: string;
  title: string | null;
  status: SessionView["status"];
  model: string | null;
  /** Archived tasks stay listable and resumable; the sidebar just stops showing them. */
  archived: boolean;
  createdAt: number;
  /** Timestamp of the newest event, so the sidebar can sort and age sessions. */
  updatedAt: number;
  lastSeq: number;
  /** False once the harness process is gone: the transcript is readable, the session is not driveable. */
  live: boolean;
  resumable: boolean;
  nativeSessionId: string | null;
  /** The session whose agent spawned this one; null for a session the user started. */
  parentSessionId: string | null;
  /** What the chat was asked and where it has got to, for anything that stands for it. */
  digest: SessionDigest;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

/** User preferences the server keeps on disk between runs. */
export interface UserPreferences {
  /** Model last chosen for a harness, keyed by harness id. */
  defaultModels: Record<string, string>;
  /** Board to reopen on a cold start, so the app never boots to nothing. */
  lastProject: string | null;
}

export interface CreateSessionInput {
  harnessId: string;
  cwd: string;
  label?: string;
  options?: Record<string, unknown>;
  /**
   * Starts the session from a harness conversation that already exists. With
   * `fork` the parent keeps running and the new session continues from a copy of
   * its history, which is how a task started off another one inherits context
   * without any of it travelling in the prompt.
   */
  resume?: { nativeSessionId: string; fork?: boolean };
}

export interface TransportService {
  listHarnesses(): Promise<HarnessDescriptor[]>;
  /** The models the harness's runtime says it can run; slow, since it may start the CLI. */
  listHarnessModels(harnessId: string): Promise<ModelInfo[]>;
  listSessions(): Promise<SessionSummary[]>;
  createSession(input: CreateSessionInput): Promise<string>;
  deleteSession(sessionId: string): Promise<void>;
  listDirectories(path: string): Promise<{ base: string; entries: DirectoryEntry[] }>;
  /** Checked-out branch of a directory, or `null` when it is not a repository. */
  workspaceBranch(path: string): Promise<string | null>;
  /** Preferences persisted in `~/.config/nib/config.json`. */
  readUserConfig(): Promise<UserPreferences>;
  saveDefaultModel(harnessId: string, model: string): Promise<void>;
  saveLastProject(cwd: string): Promise<void>;
  /** Scoped to a session so the server resolves the working directory, not the client. */
  searchFiles(sessionId: string, query: string, limit?: number): Promise<string[]>;
  /** Replays from `fromSeq`, then streams live; reconnects on its own. */
  subscribe(sessionId: string, fromSeq: number, onEvent: (event: AnyAgentEvent) => void): Disposer;
  command(sessionId: string, command: SessionCommand): Promise<void>;
  /** Every board on disk, with the workstreams it holds. The project list reads this. */
  listBoards(): Promise<BoardSummary[]>;
  /** Marks a workstream read, or clears the mark. Written server-side: the board may not be open. */
  reviewWorkstream(cwd: string, workstreamId: string, reviewed: boolean): Promise<void>;
  /** The board for a directory, or an empty one at `rev` 0. */
  loadBoard(cwd: string): Promise<BoardDoc>;
  /** Rejects when `rev` is not exactly the stored revision plus one. */
  saveBoard(board: BoardWrite): Promise<BoardDoc>;
  /** Board writes from every window on the same directory, newest `rev` first. */
  subscribeBoard(cwd: string, fromRev: number, onBoard: (board: BoardDoc) => void): Disposer;
  /**
   * The `.nib` vault for a directory: what is in it, and what points at what. Read
   * fresh every time, because the vault on disk is the source of truth and the app
   * keeps no copy of it.
   */
  loadVault(cwd: string, options?: VaultLoadOptions): Promise<VaultDoc>;
  /**
   * Moves an item into a topic directory and rewrites the path-qualified links to
   * it, in one server operation. Dragging a card between topics is a real `mv`
   * (PLAN decision 5), which is why this is a transport call and not a board write.
   */
  moveVaultEntry(
    cwd: string,
    from: string,
    toDirectory: string,
    options?: VaultMoveOptions,
  ): Promise<VaultMoveResult>;
  /**
   * Renames an item where it is and rewrites the links to it — bare names too,
   * since the name is what changed. Refused when the name is taken.
   */
  renameVaultEntry(
    cwd: string,
    from: string,
    name: string,
    options?: VaultMoveOptions,
  ): Promise<VaultMoveResult>;
  /** Writes bytes into a topic directory, answering with where they landed. */
  writeVaultFile(
    cwd: string,
    directory: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<{ path: string }>;
  /**
   * A note's body back, in place. Never renames the file: a save is not a move,
   * and every `[[link]]` to the note resolves by the name it already has.
   */
  writeVaultText(cwd: string, path: string, text: string): Promise<void>;
  /** Deletes an item from the vault. Unlinking a card from a board is not this. */
  deleteVaultEntry(cwd: string, path: string): Promise<void>;
  /**
   * Moves an item into the recycling bin. This is what Delete on a card does: a
   * gesture that reaches the filesystem has to be reversible, so the entry is
   * filed rather than unlinked and the undo stack can put it back (PLAN §13).
   */
  trashVaultEntry(cwd: string, path: string): Promise<TrashEntry>;
  /** Puts a binned entry back, answering with where it actually landed. */
  restoreTrashEntry(cwd: string, id: string): Promise<{ path: string }>;
  listTrash(cwd: string): Promise<TrashEntry[]>;
  /** Throws bytes away for good: one entry, or the whole bin when no id is given. */
  purgeTrash(cwd: string, id?: string): Promise<void>;
  /** Where a vault file is served, for an `<img>`; it is fetched by the browser, not through here. */
  vaultFileUrl(cwd: string, path: string): string;
  /** A vault file's bytes. */
  readVaultFile(cwd: string, path: string): Promise<Uint8Array>;
  /** The vault changed on disk. A file the model wrote arrives through here. */
  subscribeVault(cwd: string, onChange: () => void): Disposer;
  /** Whether the configured ComfyUI answers, and where it is. */
  comfyStatus(): Promise<ComfyStatus>;
  /** Saves the ComfyUI address and answers with the status there. */
  configureComfy(baseUrl: string): Promise<ComfyStatus>;
  comfyNodeDefinitions(refresh: boolean): Promise<ComfyNodeDefinitions>;
  /** Uploads the inputs, queues the workflow and answers with the run as queued. */
  queueComfy(input: ComfyQueueInput): Promise<ComfyRun>;
  cancelComfyRun(runId: string): Promise<void>;
  /**
   * Every run the server holds, then each change to one as it happens; and each
   * request to open a workflow in the editor, from the moment of subscribing.
   */
  subscribeComfy(
    onRun: (run: ComfyRun) => void,
    onEditorRequest: (request: ComfyEditorRequest) => void,
  ): Disposer;
  /** The workflow library; `cwd` adds that project's workflows. */
  comfyLibrary(cwd: string | null): Promise<ComfyLibraryEntry[]>;
  runComfyWorkflow(input: ComfyRunWorkflowInput): Promise<ComfyRun>;
  saveComfyWorkflow(input: ComfySaveWorkflowInput): Promise<ComfyLibraryEntry>;
  deleteComfyWorkflow(source: "user" | "project", id: string, cwd: string | null): Promise<void>;
  /** Tells every window's editor to open a workflow. */
  openComfyEditor(request: ComfyEditorRequest): Promise<void>;
}

export interface VaultLoadOptions {
  /** Quadratic over the vault's items, so it is off unless a caller asks for it. */
  mentions?: boolean;
  /** Characters of each item's body to carry, for the cards that draw one. */
  previewChars?: number;
}

export interface VaultMoveOptions {
  /** Files the forward move rewrote, so undoing it touches exactly those. */
  rewrite?: readonly string[];
}

export interface VaultMoveResult {
  from: string;
  to: string;
  rewritten: string[];
}

export interface SessionsService {
  readonly harnesses: HarnessDescriptor[];
  readonly summaries: SessionSummary[];
  readonly activeId: string | null;
  readonly active: SessionView | null;
  readonly error: string | null;
  /** Working directories used before, most recent first; survives a reload. */
  readonly recentDirectories: string[];
  events(sessionId: string): AnyAgentEvent[];
  /** Projection of any subscribed session, not just the active one. */
  view(sessionId: string): SessionView | null;
  refresh(): Promise<void>;
  create(input: CreateSessionInput): Promise<void>;
  open(sessionId: string): void;
  /** Subscribes without making the session active — for side-by-side views. */
  watch(sessionId: string): void;
  /** Reattaches a detached session to its harness so it can take turns again. */
  resume(sessionId: string): Promise<void>;
  rename(sessionId: string, label: string): Promise<void>;
  setArchived(sessionId: string, archived: boolean): Promise<void>;
  /** Discards the session and its transcript; `close` only stops the process. */
  remove(sessionId: string): Promise<void>;
  /** Attachments are stored assets; the host resolves them to files for the harness. */
  send(text: string, attachments?: MessageAttachment[]): Promise<void>;
  sendTo(sessionId: string, text: string, attachments?: MessageAttachment[]): Promise<void>;
  interrupt(): Promise<void>;
  /** `updatedInput` lets an interactive renderer answer the tool, not just approve it. */
  respondToPermission(
    requestId: string,
    behavior: PermissionBehavior,
    updatedInput?: unknown,
  ): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model: string): Promise<void>;
  setEffort(effort: string): Promise<void>;
  setLabel(label: string): Promise<void>;
  /** Restores the working tree to the checkpoint before `messageId`; the transcript stays. */
  rewind(sessionId: string, messageId: string): Promise<void>;
  /** Session ids visited in this window, so the shell can step back and forward. */
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  back(): void;
  forward(): void;
  /** Fuzzy file search inside the active session's working directory. */
  searchFiles(query: string, limit?: number): Promise<string[]>;
  listDirectories(path: string): Promise<{ base: string; entries: DirectoryEntry[] }>;
  close(sessionId: string): Promise<void>;
}

export interface RendererProps {
  block: BlockView;
  session: SessionView;
  /** The turn already names this call: render the body, not another header row. */
  detail?: boolean;
}

export interface RendererRegistration {
  kind: BlockKind;
  toolName?: string;
  priority?: number;
  component: Component<RendererProps>;
}

export interface PermissionRendererProps {
  request: PermissionRequestView;
  session: SessionView;
  respond: (behavior: PermissionBehavior, updatedInput?: unknown) => void;
}

/** Without a `toolName` the registration never matches: the app owns the fallback card. */
export interface PermissionRendererRegistration {
  toolName: string;
  priority?: number;
  component: Component<PermissionRendererProps>;
}

export interface RendererRegistry {
  register(registration: RendererRegistration): Disposer;
  setFallback(component: Component<RendererProps>): Disposer;
  /** Exact `(kind, toolName)` match first, then `kind`, then the fallback. */
  resolve(block: BlockView): Component<RendererProps> | null;
  registerPermission(registration: PermissionRendererRegistration): Disposer;
  /** Null means no plugin claims the tool, so the generic allow/deny card renders. */
  resolvePermission(toolName: string): Component<PermissionRendererProps> | null;
}

export * from "./agent-tabs";
export * from "./canvas";
export * from "./comfyui";
export * from "./composer";
export * from "./desktop";
export * from "./desktop-agent";
export * from "./display";
export * from "./fuzzy";
export * from "./panes";
export * from "./permission-modes";
export * from "./recede";
export * from "./tool-summary";

export const slotNames = [
  /**
   * The floating toolbar in the top-left corner of the board. The shell draws the
   * bar and nothing in it, so the project switcher and everything else there is
   * contributed rather than built in.
   */
  "app.toolbar",
  /**
   * The chat pane's title row: actions on the conversation it shows, and what it
   * has cost so far. Everything session-scoped that used to sit in the toolbar
   * belongs here, beside the conversation it describes.
   */
  "chat.actions",
  "composer.actions",
  "message.actions",
  "message.footer",
  "settings.section",
] as const;

export type SlotName = (typeof slotNames)[number];

export interface SlotProps {
  session: SessionView | null;
  /** Set for the per-message slots, so a plugin can summarise the turn it belongs to. */
  message?: MessageView;
}

export interface SlotRegistration {
  component: Component<SlotProps>;
  order?: number;
  when?: (session: SessionView | null) => boolean;
}

export interface SlotRegistry {
  register(slot: SlotName, registration: SlotRegistration): Disposer;
  entries(slot: SlotName, session: SessionView | null): SlotRegistration[];
}

export interface CommandRegistration {
  id: string;
  title: string;
  keybinding?: string;
  /** A command that only applies to something on screen; false keeps it out of the palette. */
  when?(): boolean;
  run(): void | Promise<void>;
}

export interface FileViewerOpenOptions {
  /**
   * False loads the file as a background tab and leaves the pane where it is:
   * what the agent happened to read must not take the tab the user is reading.
   */
  activate?: boolean;
}

/**
 * Contributed by the file-viewer plugin. It lives here so another plugin can
 * ask for a file to be opened without importing the viewer itself.
 */
export interface FileViewerService {
  open(sessionId: string, path: string, options?: FileViewerOpenOptions): void | Promise<void>;
  /**
   * A note out of a project's `.nib`, which belongs to the project rather than to
   * any session — the vault outlives every conversation about it, so it cannot be
   * addressed through one.
   */
  openVaultFile(cwd: string, path: string, options?: FileViewerOpenOptions): void | Promise<void>;
  /**
   * Any file of a project, named by the directory it sits in rather than by a
   * session in it: a project is browsable with no conversation open. The tab is
   * filed under the project-relative path, which is the path a session would
   * name too, so `close` takes it as it is.
   */
  openProjectFile(cwd: string, path: string, options?: FileViewerOpenOptions): void | Promise<void>;
  close(path: string): void;
  /**
   * Closes a vault note by its vault-relative path. Separate from `close` because
   * a vault tab is labelled by where it is in the project rather than by the path
   * a session would name, and the caller holding the path should not have to know
   * which of the two the viewer filed it under.
   */
  closeVaultFile(path: string): void;
}

/** One row in the palette that is not a command: a note, a file, a board. */
export interface SearchResult {
  id: string;
  title: string;
  /** Where it is, shown dim beside the title. */
  detail?: string;
  open(): void | Promise<void>;
}

/**
 * Something the palette searches besides its own commands. Synchronous on
 * purpose: a provider answers from what the client already holds, so a keystroke
 * costs a filter and results never arrive for a query the user has moved past.
 */
export interface SearchProvider {
  /** Heading the rows appear under. */
  group: string;
  order?: number;
  search(query: string): SearchResult[];
}

/**
 * Contributed by the web-browser plugin, so a card that stands for a page can
 * open it in the app without importing the browser itself. Clicking such a card
 * is the only way the pane is reached: it is not in the toolbar.
 */
export interface BrowserService {
  open(url: string): void;
}

export interface CommandRegistry {
  register(command: CommandRegistration): Disposer;
  list(): CommandRegistration[];
  run(id: string): void | Promise<void>;
  /** What the palette searches besides commands; contributed by plugins. */
  registerSearch(provider: SearchProvider): Disposer;
  search(query: string): { group: string; results: SearchResult[] }[];
  readonly paletteOpen: boolean;
  togglePalette(open?: boolean): void;
}

declare module "@nib-ui/kernel" {
  interface Services {
    transport: TransportService;
    sessions: SessionsService;
    renderers: RendererRegistry;
    slots: SlotRegistry;
    commands: CommandRegistry;
    panes: PaneRegistry;
    attachments: AttachmentsService;
    fileViewer: FileViewerService;
    browser: BrowserService;
    canvas: CanvasRegistry;
    desktopAgent: DesktopAgentService;
    comfy: ComfyService;
    composerTargets: ComposerTargetRegistry;
  }
  interface Events {
    "session/opened"(sessionId: string): void;
    /**
     * The work moved to another session — a harness switch replays the
     * transcript into a new one — so whatever pointed at the old id should
     * follow. The old session is untouched and stays listable.
     */
    "session/replaced"(previousSessionId: string, nextSessionId: string): void;
  }
}
