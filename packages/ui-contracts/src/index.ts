import type { Component } from 'svelte';
import type { Disposer } from '@nib-ui/kernel';
import type {
	AnyAgentEvent,
	BlockKind,
	BlockView,
	HarnessDescriptor,
	MessageAttachment,
	MessageView,
	PermissionBehavior,
	PermissionRequestView,
	SessionCommand,
	SessionView,
} from '@nib-ui/protocol';
import type { BoardDoc, BoardSummary, CanvasRegistry } from './canvas';
import type { DesktopAgentService } from './desktop-agent';
import type { AttachmentsService, PaneRegistry } from './panes';

export interface SessionSummary {
	id: string;
	harnessId: string;
	cwd: string;
	title: string | null;
	status: SessionView['status'];
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
	saveBoard(board: BoardDoc): Promise<BoardDoc>;
	/** Board writes from every window on the same directory, newest `rev` first. */
	subscribeBoard(cwd: string, fromRev: number, onBoard: (board: BoardDoc) => void): Disposer;
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
	respondToPermission(requestId: string, behavior: PermissionBehavior, updatedInput?: unknown): Promise<void>;
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

export * from './canvas';
export * from './desktop';
export * from './desktop-agent';
export * from './panes';
export * from './display';
export * from './fuzzy';
export * from './permission-modes';
export * from './tool-summary';

export const slotNames = [
	/**
	 * The left rail. The shell reserves the space and draws nothing in it, so the
	 * project list and everything else in there is contributed rather than built in.
	 */
	'app.sidebar',
	'session.header',
	'composer.actions',
	'message.actions',
	'message.footer',
	'statusbar',
	'settings.section',
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
	close(path: string): void;
}

export interface CommandRegistry {
	register(command: CommandRegistration): Disposer;
	list(): CommandRegistration[];
	run(id: string): void | Promise<void>;
	readonly paletteOpen: boolean;
	togglePalette(open?: boolean): void;
}

declare module '@nib-ui/kernel' {
	interface Services {
		transport: TransportService;
		sessions: SessionsService;
		renderers: RendererRegistry;
		slots: SlotRegistry;
		commands: CommandRegistry;
		panes: PaneRegistry;
		attachments: AttachmentsService;
		fileViewer: FileViewerService;
		canvas: CanvasRegistry;
		desktopAgent: DesktopAgentService;
	}
	interface Events {
		'session/opened'(sessionId: string): void;
		/**
		 * The work moved to another session — a harness switch replays the
		 * transcript into a new one — so whatever pointed at the old id should
		 * follow. The old session is untouched and stays listable.
		 */
		'session/replaced'(previousSessionId: string, nextSessionId: string): void;
	}
}
