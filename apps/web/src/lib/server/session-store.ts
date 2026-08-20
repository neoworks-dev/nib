import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { createSessionView, reduceSession, type AnyAgentEvent, type EmittedEvent, type SessionView } from '@nib-ui/protocol';
import type { Disposer } from '@nib-ui/kernel';
import type { HarnessSession } from './services';

export type EventListener = (event: AnyAgentEvent) => void;

/**
 * One session's append-only log. The array is the source of truth for replay,
 * the JSONL file is its durable mirror, and `view` is the same projection the
 * browser computes so the server can answer list queries cheaply.
 */
export class HostedSession {
	readonly createdAt = Date.now();
	readonly events: AnyAgentEvent[] = [];
	view: SessionView;
	harnessSession: HarnessSession | null = null;
	private seq = 0;
	private readonly subscribers = new Set<EventListener>();
	private readonly log: WriteStream;

	constructor(
		readonly id: string,
		readonly harnessId: string,
		readonly cwd: string,
		logDirectory: string,
	) {
		this.view = createSessionView(id);
		mkdirSync(logDirectory, { recursive: true });
		this.log = createWriteStream(join(logDirectory, `${id}.jsonl`), { flags: 'a' });
	}

	append(emitted: EmittedEvent): AnyAgentEvent {
		this.seq += 1;
		const event = {
			id: crypto.randomUUID(),
			sessionId: this.id,
			seq: this.seq,
			ts: Date.now(),
			...emitted,
		} as AnyAgentEvent;

		this.events.push(event);
		this.view = reduceSession(this.view, event);
		this.log.write(`${JSON.stringify(event)}\n`);
		for (const listener of [...this.subscribers]) listener(event);
		return event;
	}

	eventsSince(fromSeq: number): AnyAgentEvent[] {
		return this.events.filter((event) => event.seq > fromSeq);
	}

	subscribe(listener: EventListener): Disposer {
		this.subscribers.add(listener);
		return () => {
			this.subscribers.delete(listener);
		};
	}

	async dispose(): Promise<void> {
		this.subscribers.clear();
		await this.harnessSession?.dispose();
		this.harnessSession = null;
		this.log.end();
	}
}
