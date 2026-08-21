import type { Disposer } from '@nib-ui/kernel';
import type { GitCommitResult, GitLogEntry, GitStatus } from './git-cli';
import type {
	AnyAgentEvent,
	EmittedEvent,
	HarnessCapabilities,
	HarnessDescriptor,
	ModelInfo,
	PermissionBehavior,
	SessionCommand,
	SessionStatus,
	SessionView,
} from '@nib-ui/protocol';

/** What an adapter calls to push a normalized event; the host stamps id/seq/sessionId/ts. */
export type EmitEvent = (event: EmittedEvent) => void;

export interface HarnessSession {
	send(text: string): Promise<void>;
	interrupt(): Promise<void>;
	respondToPermission(requestId: string, response: { behavior: PermissionBehavior; updatedInput?: unknown }): void;
	setPermissionMode?(mode: string): Promise<void>;
	setModel?(model: string): Promise<void>;
	dispose(): Promise<void>;
}

export interface CreateSessionOptions {
	cwd: string;
	options?: Record<string, unknown>;
}

export interface HarnessAdapter {
	id: string;
	displayName: string;
	capabilities: HarnessCapabilities;
	/** Announced before the harness process is up, so the composer never starts empty. */
	defaultPermissionMode: string;
	models: ModelInfo[];
	defaultModel?: string;
	createSession(opts: CreateSessionOptions, emit: EmitEvent): Promise<HarnessSession>;
	resumeSession?(
		nativeSessionId: string,
		opts: CreateSessionOptions & { fork?: boolean },
		emit: EmitEvent,
	): Promise<HarnessSession>;
}

export interface HarnessRegistry {
	register(adapter: HarnessAdapter): Disposer;
	get(id: string): HarnessAdapter | undefined;
	list(): HarnessDescriptor[];
}

export interface SessionSummary {
	id: string;
	harnessId: string;
	cwd: string;
	title: string | null;
	status: SessionStatus;
	model: string | null;
	createdAt: number;
	updatedAt: number;
	lastSeq: number;
}

export interface SessionHost {
	create(input: { harnessId: string; cwd: string; label?: string; options?: Record<string, unknown> }): Promise<string>;
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
}

/** Working-tree inspection and commits for the session's repository. */
export interface GitService {
	status(cwd: string): Promise<GitStatus>;
	diff(cwd: string, path: string, staged: boolean): Promise<string>;
	stage(cwd: string, paths: string[]): Promise<GitCommitResult>;
	unstage(cwd: string, paths: string[]): Promise<GitCommitResult>;
	commit(cwd: string, message: string, paths?: string[]): Promise<GitCommitResult>;
	log(cwd: string, limit: number): Promise<GitLogEntry[]>;
}

/** Read-only filesystem probe that backs the cwd picker and `@` file references. */
export interface WorkspaceService {
	listDirectories(path: string): Promise<{ base: string; entries: { name: string; path: string }[] }>;
	searchFiles(cwd: string, query: string, limit?: number): Promise<{ path: string }[]>;
	isDirectory(path: string): Promise<boolean>;
}

declare module '@nib-ui/kernel' {
	interface Services {
		harnesses: HarnessRegistry;
		sessionHost: SessionHost;
		workspace: WorkspaceService;
		git: GitService;
	}
	interface Events {
		'session/event'(sessionId: string, event: AnyAgentEvent): void;
	}
}
