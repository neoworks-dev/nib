import type { Context, Disposer, Plugin } from '@nib-ui/kernel';
import type { AnyAgentEvent, EmittedEvent, SessionCommand, SessionView } from '@nib-ui/protocol';
import { HostedSession } from '../session-store';
import type { CreateSessionOptions, HarnessRegistry, SessionHost, SessionSummary } from '../services';

export interface SessionHostConfig {
	logDirectory: string;
}

class SessionHostService implements SessionHost {
	private readonly sessions = new Map<string, HostedSession>();

	constructor(
		private readonly ctx: Context,
		private readonly harnesses: HarnessRegistry,
		private readonly logDirectory: string,
	) {}

	async create(input: { harnessId: string; cwd: string; options?: Record<string, unknown> }): Promise<string> {
		const { adapter, hosted, emit } = this.prepare(input.harnessId, input.cwd);
		await this.attach(hosted, () => adapter.createSession({ cwd: input.cwd, options: input.options }, emit));
		return hosted.id;
	}

	async resume(input: {
		harnessId: string;
		cwd: string;
		nativeSessionId: string;
		fork?: boolean;
		options?: Record<string, unknown>;
	}): Promise<string> {
		const { adapter, hosted, emit } = this.prepare(input.harnessId, input.cwd);
		if (!adapter.resumeSession) throw new Error(`harness "${input.harnessId}" cannot resume sessions`);
		const opts: CreateSessionOptions & { fork?: boolean } = {
			cwd: input.cwd,
			options: input.options,
			fork: input.fork,
		};
		await this.attach(hosted, () => adapter.resumeSession!(input.nativeSessionId, opts, emit));
		return hosted.id;
	}

	async execute(sessionId: string, command: SessionCommand): Promise<void> {
		const hosted = this.require(sessionId);
		const session = hosted.harnessSession;
		if (!session) throw new Error(`session "${sessionId}" has no live harness session`);

		switch (command.type) {
			case 'session.send':
				return session.send(command.text);
			case 'session.interrupt':
				return session.interrupt();
			case 'session.permission.respond':
				return session.respondToPermission(command.requestId, {
					behavior: command.behavior,
					updatedInput: command.updatedInput,
				});
			case 'session.setPermissionMode':
				if (!session.setPermissionMode) throw new Error('harness does not support permission modes');
				return session.setPermissionMode(command.mode);
			case 'session.resume':
				return this.reattach(hosted, command.nativeSessionId, command.fork);
			case 'session.close':
				return this.close(sessionId);
			case 'session.create':
				throw new Error('session.create is not a per-session command');
		}
	}

	eventsSince(sessionId: string, fromSeq: number): AnyAgentEvent[] {
		return this.sessions.get(sessionId)?.eventsSince(fromSeq) ?? [];
	}

	subscribe(sessionId: string, listener: (event: AnyAgentEvent) => void): Disposer {
		return this.require(sessionId).subscribe(listener);
	}

	list(): SessionSummary[] {
		return [...this.sessions.values()].map((hosted) => ({
			id: hosted.id,
			harnessId: hosted.harnessId,
			cwd: hosted.cwd,
			title: hosted.view.title,
			status: hosted.view.status,
			createdAt: hosted.createdAt,
			lastSeq: hosted.view.lastSeq,
		}));
	}

	view(sessionId: string): SessionView | undefined {
		return this.sessions.get(sessionId)?.view;
	}

	has(sessionId: string): boolean {
		return this.sessions.has(sessionId);
	}

	async close(sessionId: string): Promise<void> {
		const hosted = this.sessions.get(sessionId);
		if (!hosted) return;
		hosted.append({ type: 'session.status', data: { status: 'closed' } });
		await hosted.dispose();
		this.sessions.delete(sessionId);
	}

	async disposeAll(): Promise<void> {
		await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
	}

	private prepare(harnessId: string, cwd: string) {
		const adapter = this.harnesses.get(harnessId);
		if (!adapter) throw new Error(`unknown harness "${harnessId}"`);
		const hosted = new HostedSession(crypto.randomUUID(), harnessId, cwd, this.logDirectory);
		this.sessions.set(hosted.id, hosted);
		const emit = (event: EmittedEvent) => {
			this.ctx.emit('session/event', hosted.id, hosted.append(event));
		};
		return { adapter, hosted, emit };
	}

	/** Adapter failures become an error event on the log instead of a lost session. */
	private async attach(hosted: HostedSession, start: () => Promise<HostedSession['harnessSession']>): Promise<void> {
		try {
			hosted.harnessSession = await start();
		} catch (error) {
			hosted.append({
				type: 'session.status',
				data: { status: 'error', detail: error instanceof Error ? error.message : String(error) },
			});
		}
	}

	private async reattach(hosted: HostedSession, nativeSessionId: string, fork?: boolean): Promise<void> {
		const adapter = this.harnesses.get(hosted.harnessId);
		if (!adapter?.resumeSession) throw new Error(`harness "${hosted.harnessId}" cannot resume sessions`);
		await hosted.harnessSession?.dispose();
		hosted.harnessSession = null;
		const emit = (event: EmittedEvent) => {
			this.ctx.emit('session/event', hosted.id, hosted.append(event));
		};
		await this.attach(hosted, () =>
			adapter.resumeSession!(nativeSessionId, { cwd: hosted.cwd, fork }, emit),
		);
	}

	private require(sessionId: string): HostedSession {
		const hosted = this.sessions.get(sessionId);
		if (!hosted) throw new Error(`unknown session "${sessionId}"`);
		return hosted;
	}
}

export const sessionHostPlugin: Plugin<SessionHostConfig> = {
	name: 'session-host',
	inject: ['harnesses'],
	apply(ctx, config) {
		const host = new SessionHostService(ctx, ctx.require('harnesses'), config.logDirectory);
		ctx.provide('sessionHost', host);
		ctx.effect(() => () => void host.disposeAll());
	},
};
