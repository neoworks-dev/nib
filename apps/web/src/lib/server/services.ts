import type { Disposer } from "@nib-ui/kernel";
import type { AnyAgentEvent, SessionCommand, SessionSummary, SessionView } from "@nib-ui/protocol";
import type { BoardDoc, BoardSummary, BoardWrite } from "@nib-ui/ui-contracts";
import type { StoreAssetOptions, StoredAsset } from "./asset-store";
import type { GitCommitResult, GitLogEntry, GitStatus } from "./git-cli";
import type { LinkPreview } from "./link-preview";
import type { VaultOpenOptions, VaultOpenResult, VaultFile } from "./vault";
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

export interface SessionHost {
  create(input: {
    harnessId: string;
    cwd: string;
    label?: string;
    options?: Record<string, unknown>;
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

/**
 * The `.nib` vault in a project directory: what a board draws. Reading is off disk
 * every time, because the vault is the source of truth and nothing caches it yet.
 */
export interface VaultService {
  open(cwd: string, options?: VaultOpenOptions): Promise<VaultOpenResult>;
  /** One file's bytes, addressed as the board addresses it. Null when unreadable. */
  readFile(cwd: string, path: string, options?: { maxBytes?: number }): Promise<VaultFile | null>;
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
}

declare module "@nib-ui/kernel" {
  interface Services {
    sessionHost: SessionHost;
    workspace: WorkspaceService;
    git: GitService;
    boards: BoardService;
    vault: VaultService;
    assets: AssetService;
    linkPreviews: LinkPreviewService;
  }
  interface Events {
    "session/event"(sessionId: string, event: AnyAgentEvent): void;
  }
}
