import {
  createWriteStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  type WriteStream,
} from "node:fs";
import { join } from "node:path";
import type { Disposer } from "@nib-ui/kernel";
import {
  type AnyAgentEvent,
  createSessionView,
  type EmittedEvent,
  reduceSession,
  type SessionView,
  safeParseAgentEvent,
} from "@nib-ui/protocol";
import type { HarnessSession } from "./services";

export type EventListener = (event: AnyAgentEvent) => void;

/**
 * One session's append-only log. The array is the source of truth for replay,
 * the JSONL file is its durable mirror, and `view` is the same projection the
 * browser computes so the server can answer list queries cheaply.
 */
export class HostedSession {
  createdAt = Date.now();
  updatedAt = Date.now();
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
    this.log = createWriteStream(join(logDirectory, `${id}.jsonl`), { flags: "a" });
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
    this.updatedAt = event.ts;
    this.view = reduceSession(this.view, event);
    this.log.write(`${JSON.stringify(event)}\n`);
    for (const listener of [...this.subscribers]) listener(event);
    return event;
  }

  /**
   * Replays a log written by an earlier process. The events are already on
   * disk, so they are folded into the projection without being written again.
   */
  restore(events: AnyAgentEvent[]): void {
    const last = events.at(-1);
    if (!last) return;
    for (const event of events) {
      this.events.push(event);
      this.view = reduceSession(this.view, event);
    }
    this.seq = last.seq;
    this.createdAt = events[0]!.ts;
    this.updatedAt = last.ts;
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

export interface StoredSessionLog {
  id: string;
  events: AnyAgentEvent[];
}

/**
 * Every session ever hosted, oldest first. A truncated or corrupt line is
 * dropped rather than failing the boot: a partial history beats none.
 */
export function readSessionLogs(logDirectory: string): StoredSessionLog[] {
  let files: string[] = [];
  try {
    files = readdirSync(logDirectory).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }

  const logs: StoredSessionLog[] = [];
  for (const file of files.sort()) {
    const events: AnyAgentEvent[] = [];
    let raw = "";
    try {
      raw = readFileSync(join(logDirectory, file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      try {
        const event = safeParseAgentEvent(JSON.parse(line));
        if (event) events.push(event);
      } catch {}
    }
    if (events.length > 0) logs.push({ id: file.slice(0, -".jsonl".length), events });
  }
  return logs.sort((left, right) => (left.events[0]?.ts ?? 0) - (right.events[0]?.ts ?? 0));
}

export function deleteSessionLog(logDirectory: string, sessionId: string): void {
  rmSync(join(logDirectory, `${sessionId}.jsonl`), { force: true });
}
