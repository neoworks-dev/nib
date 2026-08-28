import type { Disposer } from '@nib-ui/kernel';
import type { AnyAgentEvent } from './events';
import type { SessionCommand } from './commands';
import type { SessionView } from './session-view';

/** A session as a list reads it: the projection, folded down to what sorts and filters. */
export interface SessionSummary {
	id: string;
	harnessId: string;
	cwd: string;
	title: string | null;
	status: SessionView['status'];
	model: string | null;
	/** Archived sessions stay listable and resumable; a list just stops showing them. */
	archived: boolean;
	createdAt: number;
	/** Timestamp of the newest event, so a list can sort and age sessions. */
	updatedAt: number;
	lastSeq: number;
	/** False once the harness process is gone: the transcript is readable, the session is not driveable. */
	live: boolean;
	resumable: boolean;
	nativeSessionId: string | null;
}

export interface CreateSessionInput {
	harnessId: string;
	cwd: string;
	label?: string;
	options?: Record<string, unknown>;
	resume?: { nativeSessionId: string; fork?: boolean };
}

/**
 * Every session the application has ever hosted, and the one way to drive one.
 * The event log is the source of truth: `SessionView`, turns, todos, cost and
 * changed files are all folded out of it and none of them are stored.
 *
 * Every member that reaches the host is asynchronous, because the same interface
 * is consumed in-process on the server and across a wire in the browser.
 */
export interface SessionStore {
	list(): Promise<SessionSummary[]>;
	/** Mints the session id and its log, then launches through the harness broker. */
	create(input: CreateSessionInput): Promise<string>;
	command(sessionId: string, command: SessionCommand): Promise<void>;
	/** Discards the session and its transcript; `session.close` only stops the process. */
	remove(sessionId: string): Promise<void>;
	/** Replays from `fromSeq`, then streams live. Reconnects on its own. */
	subscribe(sessionId: string, fromSeq: number, onEvent: (event: AnyAgentEvent) => void): Disposer;
}
