import { attachmentMetadata, composeAttachmentPrompt } from '../../attachments';
import type { CreateSessionOptions, EmitEvent, HarnessAdapter, HarnessSession, RewindResult } from '../../services';
import { NibServer } from './server';
import {
	createNibStreamState,
	mapCheckpoints,
	mapNibEvent,
	nibCapabilities,
	nibDefaultModel,
	nibHarnessId,
	nibModels,
	parseCommands,
	parseModels,
	queueUserAttachments,
	splitModelId,
	type NibStreamState,
} from './mapping';

/** nib gates tools individually rather than putting a session into a mode. */
const permissionModeLabel = 'per-tool';

export function createNibAdapter(server: NibServer = new NibServer()): HarnessAdapter {
	return {
		id: nibHarnessId,
		displayName: 'nib',
		capabilities: nibCapabilities,
		defaultPermissionMode: permissionModeLabel,
		models: nibModels,
		defaultModel: nibDefaultModel.id,
		createSession: (opts, emit) => startSession(server, opts, emit),
		resumeSession: (nativeSessionId, opts, emit) => startSession(server, opts, emit, { nativeSessionId, fork: opts.fork }),
	};
}

interface ResumeOptions {
	nativeSessionId: string;
	fork?: boolean;
}

async function startSession(
	server: NibServer,
	opts: CreateSessionOptions,
	emit: EmitEvent,
	resume?: ResumeOptions,
): Promise<HarnessSession> {
	const baseUrl = await server.baseUrl();
	const snapshot = resume ? await attachSession(server, resume) : await createSession(server, opts);
	const nativeSessionId = readString(snapshot.id);
	if (nativeSessionId === undefined) throw new Error('nib created a session without an id');

	// A forked session's transcript is a copy of its parent's prefix, so it replays
	// from the start; a plain resume already has that history on this side and only
	// wants what happens next.
	const from = resume?.fork === true || resume === undefined ? 0 : readNumber(snapshot.lastSeq);

	let state = createNibStreamState(opts.cwd, baseUrl, nativeSessionId);
	let commands: string[] = [];
	const abort = new AbortController();
	let disposed = false;

	emit({
		type: 'session.created',
		data: { harnessId: nibHarnessId, cwd: opts.cwd, nativeSessionId, capabilities: nibCapabilities },
	});
	emit({ type: 'session.meta', data: describeMeta(snapshot) });

	const post = (event: Record<string, unknown>): Promise<unknown> =>
		server.request(`/v1/sessions/${nativeSessionId}/events`, {
			method: 'POST',
			body: JSON.stringify({ events: [event] }),
		});

	/**
	 * Usage, cost and checkpoints are session state rather than stream events, so
	 * they are read back once a turn settles instead of being tracked per delta.
	 */
	const settle = async (): Promise<void> => {
		if (disposed) return;
		try {
			const current = asRecord(await server.request(`/v1/sessions/${nativeSessionId}`));
			emit({ type: 'session.meta', data: describeMeta(current) });
			const usage = describeUsage(current);
			if (usage) emit({ type: 'usage.updated', data: usage });

			const mapped = mapCheckpoints(state, await server.request(`/v1/sessions/${nativeSessionId}/checkpoints`));
			state = mapped.state;
			for (const event of mapped.events) emit(event);
		} catch (error) {
			emit({ type: 'log', data: { level: 'debug', message: `nib settle probe failed: ${describeError(error)}` } });
		}
	};

	const follow = async (): Promise<void> => {
		let cursor = from;
		while (!disposed) {
			try {
				for await (const payload of server.stream(nativeSessionId, cursor, abort.signal)) {
					const seq = readNumber(asRecord(payload).seq);
					if (seq > cursor) cursor = seq;
					const mapped = mapNibEvent(state, payload);
					state = mapped.state;
					for (const event of mapped.events) emit(event);
					if (isTurnBoundary(payload)) void settle();
				}
			} catch (error) {
				if (disposed || abort.signal.aborted) return;
				emit({ type: 'log', data: { level: 'warn', message: `nib stream dropped: ${describeError(error)}` } });
			}
			if (disposed) return;
			// The bus replays from `cursor`, so reconnecting costs a delay and no events.
			await sleep(1000);
		}
	};

	void follow();
	void publishCatalog(server, emit).then((names) => {
		commands = names;
	});

	return {
		async send(text, attachments = []) {
			// nib keeps attached bytes in its own blob store, which this side does not
			// write to, so an attachment travels as the path it is stored at here.
			const prompt = composeAttachmentPrompt(text, attachments);
			const command = parseSlashCommand(prompt, commands);
			// A command produces no `user.message` for the metadata to land on.
			if (!command) state = queueUserAttachments(state, attachmentMetadata(attachments) ?? []);
			await post(command ?? { type: 'user.message', content: [{ type: 'text', text: prompt }] });
		},

		async interrupt() {
			await post({ type: 'user.interrupt' });
		},

		respondToPermission(requestId, response) {
			void post({
				type: 'user.tool_confirmation',
				toolUseId: requestId,
				result: response.behavior === 'allow' ? 'allow' : 'deny',
				...(response.updatedInput === undefined ? {} : { input: response.updatedInput }),
			}).catch((error: unknown) => {
				emit({ type: 'log', data: { level: 'error', message: `nib rejected the tool decision: ${describeError(error)}` } });
			});
		},

		async setModel(model) {
			const { provider, model: name } = splitModelId(model);
			await server.request(`/v1/sessions/${nativeSessionId}`, {
				method: 'PATCH',
				body: JSON.stringify(provider === undefined ? { model: name } : { provider, model: name }),
			});
			emit({ type: 'session.meta', data: { model } });
		},

		async setEffort(effort) {
			await server.request(`/v1/sessions/${nativeSessionId}`, {
				method: 'PATCH',
				body: JSON.stringify({ thinkingLevel: effort }),
			});
			emit({ type: 'session.meta', data: { effort } });
		},

		async rewind(checkpointId): Promise<RewindResult> {
			const seq = Number(checkpointId);
			if (!Number.isFinite(seq)) return { ok: false, filesChanged: [], error: `"${checkpointId}" is not a nib checkpoint` };
			try {
				const result = asRecord(
					await server.request(`/v1/sessions/${nativeSessionId}/checkpoints`, {
						method: 'POST',
						body: JSON.stringify({ seq }),
					}),
				);
				return { ok: true, filesChanged: [...readStrings(result.restored), ...readStrings(result.removed)] };
			} catch (error) {
				return { ok: false, filesChanged: [], error: describeError(error) };
			}
		},

		async dispose() {
			disposed = true;
			abort.abort();
		},
	};
}

async function createSession(server: NibServer, opts: CreateSessionOptions): Promise<Record<string, unknown>> {
	const model = readStringOption(opts.options, 'model');
	const effort = readStringOption(opts.options, 'effort');
	return asRecord(
		await server.request('/v1/sessions', {
			method: 'POST',
			body: JSON.stringify({
				workspace: opts.cwd,
				...(model === undefined ? {} : splitModelId(model)),
				...(effort === undefined ? {} : { thinkingLevel: effort }),
			}),
		}),
	);
}

/**
 * nib keeps every session on disk, so resuming is reading the snapshot back rather
 * than restarting anything. Forking copies the transcript prefix into a session of
 * its own, which is what makes it safe to take a conversation in two directions.
 */
async function attachSession(server: NibServer, resume: ResumeOptions): Promise<Record<string, unknown>> {
	const parent = asRecord(await server.request(`/v1/sessions/${resume.nativeSessionId}`));
	if (resume.fork !== true) return parent;
	return asRecord(
		await server.request(`/v1/sessions/${resume.nativeSessionId}/fork`, {
			method: 'POST',
			body: JSON.stringify({ afterSeq: readNumber(parent.lastSeq) }),
		}),
	);
}

/** Models and slash commands are server-wide in nib; both are announced per session. */
async function publishCatalog(server: NibServer, emit: EmitEvent): Promise<string[]> {
	try {
		const [models, commands] = await Promise.all([
			server.request('/v1/models').then(parseModels),
			server.request('/v1/commands').then(parseCommands),
		]);
		emit({ type: 'session.meta', data: { models, slashCommands: commands } });
		return commands.map((command) => command.name);
	} catch (error) {
		emit({ type: 'log', data: { level: 'debug', message: `nib catalog probe failed: ${describeError(error)}` } });
		return [];
	}
}

/**
 * `/name args` is only a command when nib actually registered one under that name;
 * anything else is text the user meant to send, slash and all.
 */
function parseSlashCommand(text: string, commands: string[]): Record<string, unknown> | null {
	if (!text.startsWith('/')) return null;
	const [head, ...rest] = text.slice(1).split(/\s+/);
	if (head === undefined || !commands.includes(head)) return null;
	return { type: 'user.command', name: head, args: rest.join(' ') };
}

/** nib's placeholder title until the model names the session, which is worse than our own. */
const untitled = 'Untitled session';

function describeMeta(snapshot: Record<string, unknown>) {
	const provider = readString(snapshot.provider);
	const model = readString(snapshot.model);
	const title = readString(snapshot.title);
	return {
		label: title === untitled ? undefined : title,
		model: model === undefined ? undefined : provider === undefined ? model : `${provider}/${model}`,
		effort: readString(snapshot.thinkingLevel),
		permissionMode: permissionModeLabel,
	};
}

function describeUsage(snapshot: Record<string, unknown>) {
	const usage = asRecord(snapshot.usage);
	if (typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') return null;
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cacheReadTokens: readNumber(usage.cacheReadTokens),
		costUsd: typeof snapshot.cost === 'number' ? snapshot.cost : undefined,
	};
}

/** Going idle is the only point at which nib's own totals are settled. */
function isTurnBoundary(payload: unknown): boolean {
	const event = asRecord(payload);
	return event.type === 'session.status_idle' || event.type === 'session.info_changed';
}

function readStringOption(options: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = options?.[key];
	return typeof value === 'string' ? value : undefined;
}

function readStrings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { NibStreamState };
