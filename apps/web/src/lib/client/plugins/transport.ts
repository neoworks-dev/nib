import type { Plugin } from '@nib-ui/kernel';
import { safeParseAgentEvent, type AnyAgentEvent, type HarnessDescriptor, type SessionCommand } from '@nib-ui/protocol';
import type { SessionSummary, TransportService } from '@nib-ui/ui-contracts';

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
	const response = await fetch(input, init);
	if (!response.ok) throw new Error(await response.text());
	return (await response.json()) as T;
}

class SseTransport implements TransportService {
	async listHarnesses(): Promise<HarnessDescriptor[]> {
		const { harnesses } = await requestJson<{ harnesses: HarnessDescriptor[] }>('/api/harnesses');
		return harnesses;
	}

	async listSessions(): Promise<SessionSummary[]> {
		const { sessions } = await requestJson<{ sessions: SessionSummary[] }>('/api/sessions');
		return sessions;
	}

	async createSession(input: { harnessId: string; cwd: string; options?: Record<string, unknown> }): Promise<string> {
		const { sessionId } = await requestJson<{ sessionId: string }>('/api/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input),
		});
		return sessionId;
	}

	/** EventSource reconnects on its own and sends `Last-Event-ID`, so the server resumes the replay. */
	subscribe(sessionId: string, fromSeq: number, onEvent: (event: AnyAgentEvent) => void) {
		const source = new EventSource(`/api/sessions/${sessionId}/events?fromSeq=${fromSeq}`);
		source.addEventListener('agent', (message) => {
			const event = safeParseAgentEvent(JSON.parse((message as MessageEvent<string>).data));
			if (event) onEvent(event);
		});
		return () => source.close();
	}

	async command(sessionId: string, command: SessionCommand): Promise<void> {
		await requestJson(`/api/sessions/${sessionId}/commands`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(command),
		});
	}
}

export const transportPlugin: Plugin = {
	name: 'transport',
	apply(ctx) {
		ctx.provide('transport', new SseTransport());
	},
};
