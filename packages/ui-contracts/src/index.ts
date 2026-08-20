import type { Component } from 'svelte';
import type { Disposer } from '@nib-ui/kernel';
import type {
	AnyAgentEvent,
	BlockKind,
	BlockView,
	HarnessDescriptor,
	PermissionBehavior,
	PermissionRequestView,
	SessionCommand,
	SessionView,
} from '@nib-ui/protocol';

export interface SessionSummary {
	id: string;
	harnessId: string;
	cwd: string;
	title: string | null;
	status: SessionView['status'];
	model: string | null;
	createdAt: number;
	/** Timestamp of the newest event, so the sidebar can sort and age sessions. */
	updatedAt: number;
	lastSeq: number;
}

export interface DirectoryEntry {
	name: string;
	path: string;
}

export interface CreateSessionInput {
	harnessId: string;
	cwd: string;
	label?: string;
	options?: Record<string, unknown>;
}

export interface TransportService {
	listHarnesses(): Promise<HarnessDescriptor[]>;
	listSessions(): Promise<SessionSummary[]>;
	createSession(input: CreateSessionInput): Promise<string>;
	listDirectories(path: string): Promise<{ base: string; entries: DirectoryEntry[] }>;
	/** Scoped to a session so the server resolves the working directory, not the client. */
	searchFiles(sessionId: string, query: string, limit?: number): Promise<string[]>;
	/** Replays from `fromSeq`, then streams live; reconnects on its own. */
	subscribe(sessionId: string, fromSeq: number, onEvent: (event: AnyAgentEvent) => void): Disposer;
	command(sessionId: string, command: SessionCommand): Promise<void>;
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
	refresh(): Promise<void>;
	create(input: CreateSessionInput): Promise<void>;
	open(sessionId: string): void;
	send(text: string): Promise<void>;
	interrupt(): Promise<void>;
	/** `updatedInput` lets an interactive renderer answer the tool, not just approve it. */
	respondToPermission(requestId: string, behavior: PermissionBehavior, updatedInput?: unknown): Promise<void>;
	setPermissionMode(mode: string): Promise<void>;
	setModel(model: string): Promise<void>;
	setLabel(label: string): Promise<void>;
	/** Fuzzy file search inside the active session's working directory. */
	searchFiles(query: string, limit?: number): Promise<string[]>;
	listDirectories(path: string): Promise<{ base: string; entries: DirectoryEntry[] }>;
	close(sessionId: string): Promise<void>;
}

export interface RendererProps {
	block: BlockView;
	session: SessionView;
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

export const slotNames = [
	'sidebar.nav',
	'session.header',
	'composer.actions',
	'message.actions',
	'statusbar',
	'settings.section',
] as const;

export type SlotName = (typeof slotNames)[number];

export interface SlotProps {
	session: SessionView | null;
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
	run(): void | Promise<void>;
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
	}
	interface Events {
		'session/opened'(sessionId: string): void;
	}
}
