import { describe, expect, test } from 'bun:test';
import type { SidecarState } from '@nib-ui/ui-contracts/desktop-agent';
import type { HostMessage, SidecarBody } from '../src/main/desktop-agent/protocol';
import { SidecarSupervisor, type SidecarProcess } from '../src/main/desktop-agent/supervisor';

const CAPABILITIES = {
	capture: 'portal',
	focus: 'compositor-ipc',
	pointer: 'compositor-ipc',
	compositor: 'Hyprland',
	sessionType: 'wayland',
	layerShell: true,
	notes: [],
};

function line(body: Record<string, unknown>): string {
	return `${JSON.stringify({ v: 1, ...body })}\n`;
}

/**
 * A sidecar that never was. `respond` is called synchronously from `write`, which the
 * supervisor allows by registering the pending reply before it writes — so a whole
 * request/reply exchange happens without a timer, and every test here is deterministic.
 */
class FakeSidecar implements SidecarProcess {
	written: HostMessage[] = [];
	signals: string[] = [];
	private stdout: ((chunk: string) => void) | null = null;
	private stderr: ((chunk: string) => void) | null = null;
	private exit: ((detail: string) => void) | null = null;

	constructor(private readonly respond: (message: HostMessage, sidecar: FakeSidecar) => void = () => {}) {}

	write(text: string): void {
		const message = JSON.parse(text) as HostMessage;
		this.written.push(message);
		this.respond(message, this);
	}

	kill(signal: 'SIGTERM' | 'SIGKILL'): void {
		this.signals.push(signal);
	}

	onStdout(listener: (chunk: string) => void): void {
		this.stdout = listener;
	}

	onStderr(listener: (chunk: string) => void): void {
		this.stderr = listener;
	}

	onExit(listener: (detail: string) => void): void {
		this.exit = listener;
	}

	emit(chunk: string): void {
		this.stdout?.(chunk);
	}

	log(chunk: string): void {
		this.stderr?.(chunk);
	}

	die(detail = 'code 1'): void {
		this.exit?.(detail);
	}

	types(): string[] {
		return this.written.map((message) => message.type);
	}
}

/** Answers `hello` and nothing else, which is what the step-3 sidecar does. */
function helloOnly(message: HostMessage, sidecar: FakeSidecar): void {
	if (message.type === 'hello') sidecar.emit(line({ id: message.id, type: 'capabilities', capabilities: CAPABILITIES }));
}

interface Harness {
	supervisor: SidecarSupervisor;
	states: SidecarState[];
	events: SidecarBody[];
	logs: string[];
	spawned: FakeSidecar[];
}

function harness(
	respond: (message: HostMessage, sidecar: FakeSidecar) => void = helloOnly,
	overrides: Partial<ConstructorParameters<typeof SidecarSupervisor>[0]> = {},
): Harness {
	const states: SidecarState[] = [];
	const events: SidecarBody[] = [];
	const logs: string[] = [];
	const spawned: FakeSidecar[] = [];

	const supervisor = new SidecarSupervisor({
		resolve: () => ({ executable: '/usr/bin/nib-overlay', detail: null }),
		spawn: () => {
			const sidecar = new FakeSidecar(respond);
			spawned.push(sidecar);
			return sidecar;
		},
		onState: (state) => states.push(state),
		onEvent: (event) => events.push(event),
		onLog: (level, message) => logs.push(`${level}: ${message}`),
		helloTimeoutMs: 20,
		requestTimeoutMs: 20,
		killGraceMs: 5,
		backoffMs: () => 1,
		...overrides,
	});

	return { supervisor, states, events, logs, spawned };
}

const settle = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('the handshake', () => {
	test('hello is answered with capabilities and the sidecar is ready', async () => {
		const { supervisor, states, spawned } = harness();

		expect(await supervisor.start()).toEqual({ status: 'ready' });
		expect(supervisor.capabilities).toEqual(CAPABILITIES as never);
		expect(supervisor.resolved).toBe(true);
		expect(states.map((state) => state.status)).toEqual(['starting', 'ready']);
		expect(spawned[0]?.types()).toEqual(['hello']);
	});

	test('a second start on a ready sidecar does not spawn another', async () => {
		const { supervisor, spawned } = harness();
		await supervisor.start();
		await supervisor.start();
		expect(spawned).toHaveLength(1);
	});

	test('concurrent starts share one launch', async () => {
		const { supervisor, spawned } = harness();
		await Promise.all([supervisor.start(), supervisor.start(), supervisor.start()]);
		expect(spawned).toHaveLength(1);
	});

	test('no binary fails with the reason and never spawns', async () => {
		const { supervisor, spawned } = harness(helloOnly, {
			resolve: () => ({ executable: null, detail: 'No nib-overlay binary was found.' }),
		});

		const state = await supervisor.start();
		expect(state).toEqual({ status: 'failed', detail: 'No nib-overlay binary was found.' });
		expect(supervisor.resolved).toBe(false);
		expect(spawned).toHaveLength(0);
	});

	test('a spawn that throws is a failed state, not a rejection', async () => {
		const { supervisor } = harness(helloOnly, {
			spawn: () => {
				throw new Error('permission denied');
			},
		});

		const state = await supervisor.start();
		expect(state.status).toBe('failed');
		expect(state.detail).toContain('permission denied');
	});

	test('a sidecar that never answers hello is killed rather than left running', async () => {
		const { supervisor, spawned } = harness(() => {});

		const state = await supervisor.start();
		expect(state.status).toBe('failed');
		expect(state.detail).toContain('did not answer');
		expect(spawned[0]?.signals).toContain('SIGTERM');
	});

	test('a sidecar that answers hello with an error reports that error', async () => {
		const { supervisor } = harness((message, sidecar) => {
			sidecar.emit(line({ id: message.id, type: 'err', code: 'internal', message: 'no display', retryable: false }));
		});

		const state = await supervisor.start();
		expect(state.detail).toContain('no display');
	});

	test('a killed handshake does not count as a crash and is not restarted', async () => {
		const { supervisor, spawned } = harness(() => {});
		await supervisor.start();
		spawned[0]?.die('killed by SIGTERM');
		await settle();
		expect(spawned).toHaveLength(1);
		expect(supervisor.state.status).toBe('failed');
	});
});

describe('requests', () => {
	test('a reply is matched to its request, not to the newest one', async () => {
		const { supervisor } = harness((message, sidecar) => {
			if (message.type === 'hello') return helloOnly(message, sidecar);
			// Answered out of order on purpose: correlation is by id, not by arrival.
			if (message.type === 'focus.query') {
				setTimeout(() => sidecar.emit(line({ id: message.id, type: 'ok', payload: 'focus' })), 5);
			}
			if (message.type === 'overlay.hide') sidecar.emit(line({ id: message.id, type: 'ok', payload: 'overlay' }));
		});
		await supervisor.start();

		const [focus, overlay] = await Promise.all([
			supervisor.send({ type: 'focus.query' }),
			supervisor.send({ type: 'overlay.hide' }),
		]);
		expect(focus).toEqual({ type: 'ok', payload: 'focus' });
		expect(overlay).toEqual({ type: 'ok', payload: 'overlay' });
	});

	test('an err comes back as a value rather than a rejection', async () => {
		const { supervisor } = harness((message, sidecar) => {
			if (message.type === 'hello') return helloOnly(message, sidecar);
			sidecar.emit(line({ id: message.id, type: 'err', code: 'denied', message: 'the user refused', retryable: true }));
		});
		await supervisor.start();

		expect(await supervisor.send({ type: 'focus.query' })).toEqual({
			type: 'err',
			code: 'denied',
			message: 'the user refused',
			retryable: true,
		});
	});

	test('a request nothing answers times out instead of hanging', async () => {
		const { supervisor } = harness(helloOnly);
		await supervisor.start();

		const reply = await supervisor.send({ type: 'focus.query' }, 10);
		expect(reply).toMatchObject({ type: 'err', code: 'timeout', retryable: true });
	});

	test('sending with no sidecar running answers rather than throwing', async () => {
		const { supervisor } = harness();
		expect(await supervisor.send({ type: 'focus.query' })).toMatchObject({ type: 'err', code: 'unsupported' });
	});

	test('a write that throws settles the request it belonged to', async () => {
		const { supervisor, spawned } = harness();
		await supervisor.start();
		const sidecar = spawned[0]!;
		sidecar.write = () => {
			throw new Error('EPIPE');
		};

		const reply = await supervisor.send({ type: 'focus.query' });
		expect(reply).toMatchObject({ type: 'err', code: 'internal' });
		expect((reply as { message: string }).message).toContain('EPIPE');
	});
});

describe('unsolicited messages', () => {
	test('a pointer sample with id 0 reaches onEvent', async () => {
		const { supervisor, events, spawned } = harness();
		await supervisor.start();

		spawned[0]?.emit(line({ id: 0, type: 'pointer', sample: { x: 4, y: 9, output: 'DP-1' } }));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: 'pointer', sample: { x: 4, y: 9, output: 'DP-1' } });
	});

	test('a log line is logged rather than treated as a reply', async () => {
		const { supervisor, logs, spawned } = harness();
		await supervisor.start();

		spawned[0]?.emit(line({ id: 0, type: 'log', level: 'warn', message: 'grim is missing' }));
		expect(logs).toContain('warn: grim is missing');
	});

	test('stderr is forwarded as log text and never parsed', async () => {
		const { supervisor, logs, events, spawned } = harness();
		await supervisor.start();

		spawned[0]?.log('[warn] the compositor closed the socket\n');
		expect(logs).toContain('info: [warn] the compositor closed the socket');
		expect(events).toHaveLength(0);
	});

	test('a line that is not a message is reported and the stream continues', async () => {
		const { supervisor, logs, events, spawned } = harness();
		await supervisor.start();

		spawned[0]?.emit('not json\n');
		spawned[0]?.emit(line({ id: 0, type: 'pointer', sample: { x: 1, y: 2, output: null } }));
		expect(logs.some((entry) => entry.includes('unreadable'))).toBe(true);
		expect(events).toHaveLength(1);
	});

	test('a reply to a request that already timed out is logged, not thrown', async () => {
		const { supervisor, logs, spawned } = harness(helloOnly);
		await supervisor.start();

		await supervisor.send({ type: 'focus.query' }, 5);
		spawned[0]?.emit(line({ id: 2, type: 'ok', payload: null }));
		expect(logs.some((entry) => entry.includes('nothing is waiting for'))).toBe(true);
	});
});

describe('restarting', () => {
	test('an unexpected exit is restarted', async () => {
		const { supervisor, spawned } = harness();
		await supervisor.start();

		spawned[0]?.die('code 3');
		await settle();
		expect(spawned).toHaveLength(2);
		expect(supervisor.state).toEqual({ status: 'ready' });
	});

	test('a request in flight when the sidecar dies is settled', async () => {
		const { supervisor, spawned } = harness(helloOnly);
		await supervisor.start();

		const pending = supervisor.send({ type: 'focus.query' }, 1_000);
		spawned[0]?.die('code 3');
		expect(await pending).toMatchObject({ type: 'err', code: 'internal', retryable: true });
	});

	test('it gives up after the restart budget and says how many times', async () => {
		const { supervisor, spawned } = harness((message, sidecar) => {
			helloOnly(message, sidecar);
			// Dies right after the handshake, every time.
			if (message.type === 'hello') setTimeout(() => sidecar.die('code 3'), 1);
		});
		await supervisor.start();
		await settle(80);

		// The first launch plus the three restarts the budget allows.
		expect(spawned).toHaveLength(4);
		expect(supervisor.state.status).toBe('failed');
		expect(supervisor.state.detail).toContain('will not be restarted again');
	});

	test('a sidecar that stays up long enough gets its budget back', async () => {
		const { supervisor, spawned } = harness(helloOnly, { stableAfterMs: 5 });
		await supervisor.start();

		for (let round = 0; round < 5; round += 1) {
			spawned.at(-1)?.die('code 3');
			await settle();
		}
		expect(supervisor.state).toEqual({ status: 'ready' });
		expect(spawned).toHaveLength(6);
	});
});

describe('stopping', () => {
	test('stop asks first and then makes sure', async () => {
		const { supervisor, spawned } = harness();
		await supervisor.start();

		await supervisor.stop();
		expect(spawned[0]?.types()).toEqual(['hello', 'shutdown']);
		expect(spawned[0]?.signals).toEqual(['SIGTERM']);
		expect(supervisor.state).toEqual({ status: 'stopped' });

		await settle(15);
		expect(spawned[0]?.signals).toEqual(['SIGTERM', 'SIGKILL']);
	});

	test('the exit that follows a stop is not a crash', async () => {
		const { supervisor, spawned } = harness();
		await supervisor.start();

		await supervisor.stop();
		spawned[0]?.die('killed by SIGTERM');
		await settle();
		expect(spawned).toHaveLength(1);
		expect(supervisor.state).toEqual({ status: 'stopped' });
	});

	test('stopping a sidecar that is not running is not an error', async () => {
		const { supervisor } = harness();
		await supervisor.stop();
		expect(supervisor.state).toEqual({ status: 'stopped' });
	});

	test('capabilities are dropped, so the report stops claiming a dead sidecar', async () => {
		const { supervisor } = harness();
		await supervisor.start();
		await supervisor.stop();
		expect(supervisor.capabilities).toBeNull();
	});

	test('a disposed supervisor never starts again', async () => {
		const { supervisor, spawned } = harness();
		await supervisor.start();
		await supervisor.dispose();

		const state = await supervisor.start();
		expect(state.status).toBe('failed');
		expect(spawned).toHaveLength(1);
	});
});
