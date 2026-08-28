/**
 * Owns the `nib-overlay` child process: spawns it, correlates replies, restarts it when it
 * dies unexpectedly, and kills it on disposal.
 *
 * The process is injected rather than spawned here, so the lifetime rules — the hello
 * handshake, the reply table, the restart budget, the kill escalation — are testable
 * without a binary. `spawnSidecarProcess` in `child.ts` is the one implementation that
 * touches `node:child_process`.
 *
 * The worst failure this feature has is a sidecar that outlives the app while holding a
 * layer surface, so disposal escalates to `SIGKILL` rather than trusting a graceful exit.
 */
import {
	encode,
	EVENT_ID,
	FrameReader,
	PROTOCOL_VERSION,
	request,
	type DecodedMessage,
	type HostRequest,
	type SidecarBody,
	type SidecarCapabilities,
	type SidecarErrorCode,
} from './protocol';
import type { SidecarState } from '@nib-ui/ui-contracts/desktop-agent';

/** The child process, as this module needs it. Text in, text out, and a way to end it. */
export interface SidecarProcess {
	write(line: string): void;
	kill(signal: 'SIGTERM' | 'SIGKILL'): void;
	onStdout(listener: (chunk: string) => void): void;
	/** Log text, never protocol. Forwarded to the main-process console. */
	onStderr(listener: (chunk: string) => void): void;
	onExit(listener: (detail: string) => void): void;
}

export type SpawnSidecar = (executable: string) => SidecarProcess;

/**
 * Every reply is one of these. Nothing here rejects: a portal the user refused, a sidecar
 * that is not running and a request that timed out are all answers a caller renders, and
 * wrapping each of them in a `try` at every call site buys nothing.
 */
export type SidecarReply =
	| { type: 'ok'; payload: unknown }
	| { type: 'err'; code: SidecarErrorCode; message: string; retryable: boolean };

export interface SupervisorOptions {
	/** Null means no binary was found; `detail` is shown in the failed state. */
	resolve: () => { executable: string | null; detail: string | null };
	spawn: SpawnSidecar;
	onState?: (state: SidecarState) => void;
	onEvent?: (event: SidecarBody) => void;
	onLog?: (level: string, message: string) => void;
	helloTimeoutMs?: number;
	requestTimeoutMs?: number;
	/** How long a `SIGTERM` has before `SIGKILL`. */
	killGraceMs?: number;
	maxRestarts?: number;
	/**
	 * How long a sidecar has to stay up before its restart budget is refilled. Refilling
	 * on the handshake alone would let a process that dies straight after `hello` restart
	 * without end, which is the shape a crash loop actually has.
	 */
	stableAfterMs?: number;
	backoffMs?: (attempt: number) => number;
}

function fail(code: SidecarErrorCode, message: string, retryable = false): SidecarReply {
	return { type: 'err', code, message, retryable };
}

export class SidecarSupervisor {
	private child: SidecarProcess | null = null;
	private reader = new FrameReader();
	private pending = new Map<number, (reply: SidecarReply) => void>();
	private nextId = 1;
	private restarts = 0;
	/** When the current sidecar reached `ready`; null while it is not up. */
	private readyAt: number | null = null;
	private disposed = false;
	/**
	 * Bumped whenever a child is discarded. An exit from a generation we already walked
	 * away from — a killed handshake, a `stop()` — is not a crash and must not restart.
	 */
	private generation = 0;
	private starting: Promise<SidecarState> | null = null;

	private readonly options: Required<Omit<SupervisorOptions, 'onState' | 'onEvent' | 'onLog'>> &
		Pick<SupervisorOptions, 'onState' | 'onEvent' | 'onLog'>;

	state: SidecarState = { status: 'stopped' };
	capabilities: SidecarCapabilities | null = null;
	/** False when no binary resolved. The capability report needs this, not just the state. */
	resolved = false;

	constructor(options: SupervisorOptions) {
		this.options = {
			helloTimeoutMs: 3_000,
			requestTimeoutMs: 15_000,
			killGraceMs: 2_000,
			maxRestarts: 3,
			stableAfterMs: 30_000,
			backoffMs: (attempt) => Math.min(500 * 2 ** (attempt - 1), 4_000),
			...options,
		};
	}

	/** Starts the sidecar if it is down. Concurrent calls share one start. */
	start(): Promise<SidecarState> {
		if (this.disposed) return Promise.resolve({ status: 'failed', detail: 'The desktop agent was disposed.' });
		if (this.child && this.state.status === 'ready') return Promise.resolve(this.state);
		if (this.starting) return this.starting;

		this.starting = this.launch().finally(() => {
			this.starting = null;
		});
		return this.starting;
	}

	private async launch(): Promise<SidecarState> {
		const { executable, detail } = this.options.resolve();
		this.resolved = executable !== null;
		if (!executable) return this.setState({ status: 'failed', detail: detail ?? 'No sidecar binary was found.' });

		this.setState({ status: 'starting' });
		this.reader.reset();

		let child: SidecarProcess;
		try {
			child = this.options.spawn(executable);
		} catch (cause) {
			return this.setState({
				status: 'failed',
				detail: `${executable} could not be started: ${cause instanceof Error ? cause.message : String(cause)}`,
			});
		}

		const generation = ++this.generation;
		this.child = child;
		child.onStdout((chunk) => this.receive(this.reader.push(chunk)));
		child.onStderr((chunk) => this.options.onLog?.('info', chunk.trimEnd()));
		child.onExit((exitDetail) => {
			if (generation === this.generation) this.handleExit(exitDetail);
		});

		const reply = await this.send({ type: 'hello', protocol: PROTOCOL_VERSION }, this.options.helloTimeoutMs);
		// The handshake succeeded only if `capabilities` arrived: an `err`, a timeout or a
		// bare `ok` all leave nothing to report and mean the sidecar is not usable.
		if (!this.capabilities) {
			const why = reply.type === 'err' ? reply.message : 'the sidecar answered hello with something else';
			this.killChild();
			return this.setState({ status: 'failed', detail: `The sidecar did not report its capabilities: ${why}` });
		}

		this.readyAt = Date.now();
		return this.setState({ status: 'ready' });
	}

	/**
	 * Sends a request and waits for its reply. Answers `err` rather than throwing when the
	 * sidecar is not running, so a caller does not have to check the state first and then
	 * race it.
	 */
	send(body: HostRequest, timeoutMs = this.options.requestTimeoutMs): Promise<SidecarReply> {
		const child = this.child;
		if (!child) return Promise.resolve(fail('unsupported', 'The desktop sidecar is not running.', true));

		const id = this.nextId++;
		return new Promise<SidecarReply>((resolve) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve(fail('timeout', `The sidecar did not answer \`${body.type}\` in ${timeoutMs} ms.`, true));
			}, timeoutMs);

			this.pending.set(id, (reply) => {
				clearTimeout(timer);
				this.pending.delete(id);
				resolve(reply);
			});

			try {
				child.write(encode(request(id, body)));
			} catch (cause) {
				this.pending.get(id)?.(
					fail('internal', `Writing to the sidecar failed: ${cause instanceof Error ? cause.message : String(cause)}`),
				);
			}
		});
	}

	private receive(messages: DecodedMessage[]): void {
		for (const message of messages) {
			if (message.type === 'malformed') {
				this.options.onLog?.('warn', `sidecar sent something unreadable (${message.reason}): ${message.sample}`);
				continue;
			}

			if (message.type === 'log') {
				this.options.onLog?.(message.level, message.message);
				continue;
			}

			if (message.type === 'capabilities') {
				this.capabilities = message.capabilities;
				// It answers `hello`, so it settles that request as well as updating state.
				this.pending.get(message.id)?.({ type: 'ok', payload: message.capabilities });
				continue;
			}

			if (message.id === EVENT_ID) {
				this.options.onEvent?.(message);
				continue;
			}

			const settle = this.pending.get(message.id);
			if (!settle) {
				this.options.onLog?.('warn', `sidecar answered request ${message.id}, which nothing is waiting for`);
				continue;
			}
			settle(
				message.type === 'err'
					? { type: 'err', code: message.code, message: message.message, retryable: message.retryable }
					: { type: 'ok', payload: message.type === 'ok' ? message.payload : message },
			);
		}
	}

	private handleExit(detail: string): void {
		this.child = null;
		this.capabilities = null;
		this.settleAllPending(fail('internal', `The sidecar exited: ${detail}`, true));

		const uptime = this.readyAt === null ? 0 : Date.now() - this.readyAt;
		this.readyAt = null;
		if (uptime >= this.options.stableAfterMs) this.restarts = 0;

		if (this.disposed) {
			this.setState({ status: 'stopped' });
			return;
		}

		if (this.restarts >= this.options.maxRestarts) {
			this.setState({
				status: 'failed',
				detail: `The sidecar exited ${this.restarts + 1} times (${detail}) and will not be restarted again.`,
			});
			return;
		}

		this.restarts += 1;
		const wait = this.options.backoffMs(this.restarts);
		this.setState({ status: 'starting', detail: `The sidecar exited (${detail}); restarting in ${wait} ms.` });
		setTimeout(() => {
			if (this.disposed || this.child) return;
			void this.start();
		}, wait).unref?.();
	}

	private settleAllPending(reply: SidecarReply): void {
		for (const settle of [...this.pending.values()]) settle(reply);
		this.pending.clear();
	}

	private killChild(): void {
		const child = this.child;
		if (!child) return;
		this.child = null;
		this.capabilities = null;
		this.readyAt = null;
		this.generation += 1;
		child.kill('SIGTERM');
		setTimeout(() => child.kill('SIGKILL'), this.options.killGraceMs).unref?.();
	}

	/**
	 * Asks the sidecar to leave, then makes sure of it. `shutdown` is sent without waiting
	 * for a reply — the process exiting is the reply.
	 */
	async stop(): Promise<void> {
		if (!this.child) {
			this.setState({ status: 'stopped' });
			return;
		}
		try {
			this.child.write(encode(request(this.nextId++, { type: 'shutdown' })));
		} catch {
			// Already gone; the kill below is the fallback either way.
		}
		this.killChild();
		this.settleAllPending(fail('internal', 'The desktop agent was stopped.'));
		this.setState({ status: 'stopped' });
	}

	/** Terminal: after this the supervisor never starts again. */
	async dispose(): Promise<void> {
		this.disposed = true;
		await this.stop();
	}

	private setState(state: SidecarState): SidecarState {
		this.state = state;
		this.options.onState?.(state);
		return state;
	}
}
