import type { Disposer } from '@nib-ui/kernel';
import type {
	AnyAgentEvent,
	EmittedEvent,
	HarnessCapabilities,
	HarnessDescriptor,
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
	createdAt: number;
	lastSeq: number;
}

export interface SessionHost {
	create(input: { harnessId: string; cwd: string; options?: Record<string, unknown> }): Promise<string>;
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

declare module '@nib-ui/kernel' {
	interface Services {
		harnesses: HarnessRegistry;
		sessionHost: SessionHost;
	}
	interface Events {
		'session/event'(sessionId: string, event: AnyAgentEvent): void;
	}
}
