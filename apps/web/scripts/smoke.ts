/**
 * Headless adapter smoke test: starts a Claude Code session, prints every
 * normalized event as JSONL, auto-allows permission prompts and exits when the
 * turn goes idle.
 *
 *   bun apps/web/scripts/smoke.ts "list the files here"
 */
import { isKnownEvent, type AnyAgentEvent } from '@nib-ui/protocol';
import { sessionHost } from '../src/lib/server/context';

const prompt = process.argv[2] ?? 'list the files here';
const cwd = process.argv[3] ?? process.cwd();
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000);

const host = sessionHost();
const sessionId = await host.create({ harnessId: 'claude-code', cwd });

let settle: (reason: string) => void = () => {};
const finished = new Promise<string>((resolve) => {
	settle = resolve;
});

const unsubscribe = host.subscribe(sessionId, (event: AnyAgentEvent) => {
	console.log(JSON.stringify(event));
	if (!isKnownEvent(event)) return;
	if (event.type === 'permission.requested') {
		host.execute(sessionId, {
			type: 'session.permission.respond',
			requestId: event.data.requestId,
			behavior: 'allow',
		});
	}
	if (event.type === 'session.status' && event.data.status === 'idle') settle('idle');
	if (event.type === 'session.status' && event.data.status === 'error') settle(`error: ${event.data.detail}`);
});

const timeout = setTimeout(() => settle('timeout'), timeoutMs);

await host.execute(sessionId, { type: 'session.send', text: prompt });
const reason = await finished;

clearTimeout(timeout);
unsubscribe();
await host.execute(sessionId, { type: 'session.close' });

console.error(`smoke finished: ${reason}`);
process.exit(reason === 'idle' ? 0 : 1);
