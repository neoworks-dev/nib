import type { Component } from 'svelte';
import type { Disposer } from '@nib-ui/kernel';
import type {
	AnyAgentEvent,
	BlockKind,
	BlockView,
	HarnessDescriptor,
	PermissionBehavior,
	SessionCommand,
	SessionView,
} from '@nib-ui/protocol';

export interface SessionSummary {
	id: string;
	harnessId: string;
	cwd: string;
	title: string | null;
	status: SessionView['status'];
	createdAt: number;
	lastSeq: number;
}

export interface TransportService {
	listHarnesses(): Promise<HarnessDescriptor[]>;
	listSessions(): Promise<SessionSummary[]>;
	createSession(input: { harnessId: string; cwd: string; options?: Record<string, unknown> }): Promise<string>;
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
	events(sessionId: string): AnyAgentEvent[];
	refresh(): Promise<void>;
	create(harnessId: string, cwd: string): Promise<void>;
	open(sessionId: string): void;
	send(text: string): Promise<void>;
	interrupt(): Promise<void>;
	respondToPermission(requestId: string, behavior: PermissionBehavior): Promise<void>;
	setPermissionMode(mode: string): Promise<void>;
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

export interface RendererRegistry {
	register(registration: RendererRegistration): Disposer;
	setFallback(component: Component<RendererProps>): Disposer;
	/** Exact `(kind, toolName)` match first, then `kind`, then the fallback. */
	resolve(block: BlockView): Component<RendererProps> | null;
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
