import type { Disposer } from "@nib-ui/kernel";
import type {
  AgentControlLink,
  AgentControlTool,
  AnyAgentEvent,
  SessionCommand,
  SessionSummary,
  SessionView,
} from "@nib-ui/protocol";
import type {
  BoardDoc,
  BoardSummary,
  BoardWrite,
  ComfyNodeDefinitions,
  ComfyQueueInput,
  ComfyRun,
  ComfyStatus,
} from "@nib-ui/ui-contracts";
import type { TrashEntry } from "@nib-ui/vault";
import type { StoreAssetOptions, StoredAsset } from "./asset-store";
import type { ComfyLibrary } from "./comfyui-library";
import type { PlacementWrite } from "./board-store";
import type { GitCommitResult, GitLogEntry, GitStatus } from "./git-cli";
import type { LinkPreview } from "./link-preview";
import type { PinterestBoard, PinterestCredentials, PinterestPin } from "./pinterest";
import type {
  ByteRange,
  VaultFile,
  VaultFileInfo,
  VaultOpenOptions,
  VaultOpenResult,
} from "./vault";
import type { VaultMoveOptions, VaultMoveResult, VaultWriteResult } from "./vault-write";
import type { WorkspaceIcon } from "./workspace-icon";

export type {
  CreateSessionOptions,
  EmitEvent,
  HarnessAdapter,
  HarnessRegistry,
  HarnessSession,
  RewindResult,
  SessionAttachment,
  SessionSummary,
} from "@nib-ui/protocol";

/**
 * Mints the endpoint one session's agent drives other sessions through. Async
 * because the loopback listener is started on the first link and only then knows
 * the port the operating system gave it.
 */
export type AgentControlProvider = (sessionId: string) => Promise<AgentControlLink>;

/**
 * Tools another plugin adds to every session's set, built per session. `requireCwd`
 * is the calling session's project, since tools act on the vault it works in.
 */
export type AgentToolSource = (session: {
  sessionId: string;
  requireCwd: () => string;
}) => AgentControlTool[];

export interface AgentControlService {
  /** The same link on every call for a session: the secret in the url is minted once. */
  linkFor(sessionId: string): Promise<AgentControlLink>;
  /** Hands every session these tools too, from its next tool listing on. */
  addToolSource(source: AgentToolSource): Disposer;
}

export interface SessionHost {
  /**
   * Registers where per-session agent-control links come from. The host asks the
   * provider for one before it hands a session to its adapter, so a session
   * created while nothing is registered simply runs without the tools.
   */
  useAgentControl(provider: AgentControlProvider): Disposer;
  create(input: {
    harnessId: string;
    cwd: string;
    label?: string;
    options?: Record<string, unknown>;
    /** The session whose agent is spawning this one; recorded on the log as lineage. */
    parentSessionId?: string;
  }): Promise<string>;
  resume(input: {
    harnessId: string;
    cwd: string;
    nativeSessionId: string;
    fork?: boolean;
    options?: Record<string, unknown>;
  }): Promise<string>;
  execute(sessionId: string, command: SessionCommand): Promise<void>;
  eventsSince(sessionId: string, fromSeq: number): AnyAgentEvent[];
  subscribe(sessionId: string, listener: (event: AnyAgentEvent) => void): Disposer;
  list(): SessionSummary[];
  view(sessionId: string): SessionView | undefined;
  has(sessionId: string): boolean;
  /** Discards the session and its log; `session.close` only detaches the process. */
  remove(sessionId: string): Promise<void>;
}

/** Working-tree inspection and commits for the session's repository. */
export interface GitService {
  status(cwd: string): Promise<GitStatus>;
  branch(cwd: string): Promise<string | null>;
  diff(cwd: string, path: string, staged: boolean): Promise<string>;
  stage(cwd: string, paths: string[]): Promise<GitCommitResult>;
  unstage(cwd: string, paths: string[]): Promise<GitCommitResult>;
  commit(cwd: string, message: string, paths?: string[]): Promise<GitCommitResult>;
  log(cwd: string, limit: number): Promise<GitLogEntry[]>;
}

/** Read-only filesystem probe that backs the cwd picker and `@` file references. */
export interface WorkspaceService {
  listDirectories(
    path: string,
  ): Promise<{ base: string; entries: { name: string; path: string }[] }>;
  searchFiles(cwd: string, query: string, limit?: number): Promise<{ path: string }[]>;
  isDirectory(path: string): Promise<boolean>;
  findIcon(path: string): Promise<WorkspaceIcon | null>;
}

/**
 * One board per working directory, persisted as JSON. Writes are guarded by
 * `rev` and broadcast, so every window on the same directory stays in step.
 */
export interface BoardService {
  read(cwd: string): Promise<BoardDoc>;
  /** Every board on disk, reduced to its directory and the workstreams on it. */
  list(): Promise<BoardSummary[]>;
  /** Throws when `board.rev` is not exactly the stored revision plus one. */
  write(board: BoardWrite): Promise<BoardDoc>;
  /** Moves cards on the board the vault's items sit on, read-modify-write in one link of the chain. */
  place(cwd: string, writes: readonly PlacementWrite[]): Promise<BoardDoc>;
  /** Sets or clears a workstream's review mark; throws when the workstream is gone. */
  reviewWorkstream(cwd: string, workstreamId: string, reviewed: boolean): Promise<BoardDoc>;
  subscribe(cwd: string, listener: (board: BoardDoc) => void): Disposer;
}

/** Content-addressed blobs pasted or dropped onto a board, or attached to a prompt. */
export interface AssetService {
  store(bytes: Uint8Array, options?: StoreAssetOptions): Promise<StoredAsset>;
  read(assetId: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  /** Absolute path of the stored bytes; null once the asset is gone. */
  path(assetId: string): Promise<string | null>;
}

export interface LinkPreviewService {
  /** Cached by url: a board that reloads must not re-scrape every card. */
  preview(url: string): Promise<LinkPreview>;
}

/** What the browser is told about the connection. Never the secret or the tokens. */
export interface PinterestStatus {
  configured: boolean;
  connected: boolean;
  appId?: string;
  redirectUri?: string;
  scope?: string;
}

/**
 * The user's own Pinterest account, read through the v5 API. Pinterest has no
 * notion of a favourite — likes were removed from the product — so what the pane
 * shows is the boards and the pins saved to them.
 */
export interface PinterestService {
  status(): Promise<PinterestStatus>;
  /** Registers the developer app. Any existing connection is dropped with it. */
  configure(credentials: PinterestCredentials): Promise<PinterestStatus>;
  /** The url to send the user to, with a one-shot state recorded against it. */
  beginAuth(): Promise<string>;
  completeAuth(code: string, state: string): Promise<void>;
  disconnect(): Promise<void>;
  boards(): Promise<PinterestBoard[]>;
  pins(boardId: string): Promise<PinterestPin[]>;
  /** Copies one pin's picture into the asset store, so a board never hotlinks it. */
  storeImage(imageUrl: string): Promise<StoredAsset>;
}

/**
 * The local ComfyUI server. Runs are followed over one socket and their outputs
 * are written into the vault of the project that queued them, so they reach the
 * board the way any other file does.
 */
export interface ComfyUIService {
  status(): Promise<ComfyStatus>;
  /** Saves the address; runs on the previous server stop being followed. */
  configure(baseUrl: string): Promise<ComfyStatus>;
  nodeDefinitions(refresh: boolean): Promise<ComfyNodeDefinitions>;
  queue(input: ComfyQueueInput): Promise<ComfyRun>;
  cancel(runId: string): Promise<void>;
  /** Newest first. */
  runs(): ComfyRun[];
  subscribe(listener: (run: ComfyRun) => void): Disposer;
}

/**
 * The `.nib` vault in a project directory: what a board draws. Reading is off disk
 * every time, because the vault is the source of truth and nothing caches it yet.
 */
export interface VaultService {
  open(cwd: string, options?: VaultOpenOptions): Promise<VaultOpenResult>;
  /** One file's bytes, addressed as the board addresses it. Null when unreadable. */
  readFile(cwd: string, path: string, options?: { maxBytes?: number }): Promise<VaultFile | null>;
  /** What a file is, without reading it: size and type, for serving it in pieces. */
  statFile(cwd: string, path: string): Promise<VaultFileInfo | null>;
  /** A file, or one range of it, as a body a response can stream out. */
  fileStream(info: VaultFileInfo, range?: ByteRange): ReadableStream<Uint8Array>;
  /** `mv` plus the link rewrite that keeps path-qualified references pointing home. */
  move(
    cwd: string,
    from: string,
    toDirectory: string,
    options?: VaultMoveOptions,
  ): Promise<VaultMoveResult>;
  /** Bytes into a topic directory, under a name that is free. */
  write(cwd: string, directory: string, name: string, bytes: Uint8Array): Promise<VaultWriteResult>;
  /** A note's body back, in place. Never renames, so links to it survive the save. */
  writeText(cwd: string, path: string, text: string): Promise<void>;
  /** Removes the entry from disk; a topic takes its contents with it. */
  delete(cwd: string, path: string): Promise<void>;
  /**
   * Moves the entry into the recycling bin, which is what the board's own delete
   * does: reversible by the undo stack and by the bin, rather than a confirm box
   * over an unlink.
   */
  trash(cwd: string, path: string): Promise<TrashEntry>;
  /** Puts a binned entry back where it came from, under a name that is free. */
  restoreTrash(cwd: string, id: string): Promise<{ path: string }>;
  listTrash(cwd: string): Promise<TrashEntry[]>;
  /** Throws bytes away for good: one entry, or the whole bin. */
  purgeTrash(cwd: string, id?: string): Promise<void>;
}

declare module "@nib-ui/kernel" {
  interface Services {
    sessionHost: SessionHost;
    agentControl: AgentControlService;
    workspace: WorkspaceService;
    git: GitService;
    boards: BoardService;
    vault: VaultService;
    assets: AssetService;
    linkPreviews: LinkPreviewService;
    pinterest: PinterestService;
    comfyui: ComfyUIService;
    comfyWorkflows: ComfyLibrary;
  }
  interface Events {
    "session/event"(sessionId: string, event: AnyAgentEvent): void;
  }
}
