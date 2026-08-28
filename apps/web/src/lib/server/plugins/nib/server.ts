import { spawn, type ChildProcess } from 'node:child_process';
import { resolveNibCommand } from './binary';

const startupTimeoutMs = 30_000;
const healthPollMs = 100;
const bindAttempts = 5;

/**
 * The nib server every session talks to.
 *
 * nib is one process serving many sessions, so the adapter owns a single instance
 * rather than one per session. `NIB_URL` attaches to a server the user already runs
 * — a development server with `--watch`, or one shared with a terminal client — and
 * nothing is spawned or killed in that case.
 */
export class NibServer {
	private starting: Promise<string> | null = null;
	private child: ChildProcess | null = null;

	async baseUrl(): Promise<string> {
		const configured = process.env.NIB_URL?.trim();
		if (configured) return configured.replace(/\/+$/, '');
		this.starting ??= this.spawnServer();
		return this.starting;
	}

	async request(path: string, init?: RequestInit): Promise<unknown> {
		const base = await this.baseUrl();
		const response = await fetch(`${base}${path}`, {
			...init,
			headers: { 'content-type': 'application/json', ...init?.headers },
		});
		const body = await response.text();
		if (!response.ok) throw new Error(`nib ${init?.method ?? 'GET'} ${path} failed (${response.status}): ${body}`);
		return body.length === 0 ? null : JSON.parse(body);
	}

	/**
	 * Follows a session's transcript from `afterSeq`. The bus replays the gap and
	 * then continues live in the same tick, so nothing can slip between catching up
	 * and attaching.
	 */
	async *stream(sessionId: string, afterSeq: number, signal: AbortSignal): AsyncGenerator<unknown> {
		const base = await this.baseUrl();
		const response = await fetch(`${base}/v1/sessions/${sessionId}/stream`, {
			headers: { accept: 'text/event-stream', 'last-event-id': String(afterSeq) },
			signal,
		});
		if (!response.ok || !response.body) throw new Error(`nib stream failed (${response.status})`);

		const decoder = new TextDecoder();
		let buffer = '';
		for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
			buffer += decoder.decode(chunk, { stream: true });
			let boundary = buffer.indexOf('\n\n');
			while (boundary >= 0) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				boundary = buffer.indexOf('\n\n');
				const payload = readData(frame);
				if (payload !== null) yield payload;
			}
		}
	}

	async stop(): Promise<void> {
		const child = this.child;
		this.child = null;
		this.starting = null;
		if (!child || child.exitCode !== null) return;
		child.kill('SIGTERM');
	}

	/**
	 * nib's config rejects port 0 and it has no way to report the port it settled on,
	 * so a port is guessed and a process that dies on a taken one is retried against
	 * the next guess. Its output is inherited rather than piped: a local tool's server
	 * log belongs on the console, and reading it back would need a stream listener
	 * `bun-types` does not declare.
	 */
	private async spawnServer(): Promise<string> {
		const command = resolveNibCommand();

		for (let attempt = 0; attempt < bindAttempts; attempt += 1) {
			const port = 40000 + Math.floor(Math.random() * 20000);
			const base = `http://127.0.0.1:${port}`;
			const child = spawn(command[0]!, [...command.slice(1), '--host', '127.0.0.1', '--port', String(port)], {
				stdio: ['ignore', 'inherit', 'inherit'],
			});
			this.child = child;

			const deadline = Date.now() + startupTimeoutMs;
			while (Date.now() < deadline && child.exitCode === null) {
				if (await isHealthy(base)) return base;
				await sleep(healthPollMs);
			}

			if (child.exitCode === null) {
				child.kill('SIGTERM');
				throw new Error(`nib server did not answer /v1/health within ${startupTimeoutMs / 1000}s`);
			}
			this.child = null;
		}

		throw new Error(`nib server exited on every one of ${bindAttempts} start attempts — see its output above`);
	}
}

async function isHealthy(base: string): Promise<boolean> {
	try {
		const response = await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(1000) });
		return response.ok;
	} catch {
		return false;
	}
}

function readData(frame: string): unknown {
	const data = frame
		.split('\n')
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).trimStart())
		.join('\n');
	if (data.length === 0) return null;
	try {
		return JSON.parse(data);
	} catch {
		return null;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
