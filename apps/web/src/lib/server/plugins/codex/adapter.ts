import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SandboxMode, Thread, ThreadOptions } from '@openai/codex-sdk';
import { attachmentMetadata, composeAttachmentPrompt } from '../../attachments';
import type { CreateSessionOptions, EmitEvent, HarnessAdapter, HarnessSession } from '../../services';
import { resolveCodexExecutable } from './binary';
import {
	codexCapabilities,
	codexDefaultModel,
	codexHarnessId,
	codexModels,
	createCodexStreamState,
	mapCodexEvent,
	mapUserText,
	parseModelCache,
	type CodexStreamState,
} from './mapping';

const sandboxModes: SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access'];
const defaultSandboxMode: SandboxMode = 'workspace-write';

export function createCodexAdapter(): HarnessAdapter {
	return {
		id: codexHarnessId,
		displayName: 'Codex',
		capabilities: codexCapabilities,
		defaultPermissionMode: defaultSandboxMode,
		models: codexModels,
		defaultModel: codexDefaultModel.id,
		createSession: (opts, emit) => startSession(opts, emit),
		resumeSession: (nativeSessionId, opts, emit) => {
			if (opts.fork) throw new Error('codex cannot fork a thread');
			return startSession(opts, emit, nativeSessionId);
		},
	};
}

async function startSession(
	opts: CreateSessionOptions,
	emit: EmitEvent,
	resumeThreadId?: string,
): Promise<HarnessSession> {
	const executable = resolveCodexExecutable();
	// Dynamic so the SDK never lands in a bundle that the client could pull in.
	const { Codex } = await import('@openai/codex-sdk');
	const codex = new Codex({ codexPathOverride: executable });

	let threadOptions: ThreadOptions = {
		workingDirectory: opts.cwd,
		sandboxMode: readSandboxMode(opts.options) ?? defaultSandboxMode,
		// The workspace picker offers any directory, and Codex otherwise refuses to
		// start outside a repository.
		skipGitRepoCheck: true,
		// Nothing can answer an approval prompt on a non-interactive stream, so any
		// other policy stalls the turn instead of escalating to the user.
		approvalPolicy: 'never',
		...readModelOption(opts.options),
	};
	let thread: Thread = resumeThreadId
		? codex.resumeThread(resumeThreadId, threadOptions)
		: codex.startThread(threadOptions);

	let state: CodexStreamState = createCodexStreamState(opts.cwd, resumeThreadId ?? null);
	let turns: Promise<void> = Promise.resolve();
	let currentTurn: AbortController | null = null;
	let disposed = false;

	// A resumed thread only announces its id again on the next `thread.started`,
	// so the log would lose the native id until the user sends something.
	if (resumeThreadId) {
		emit({
			type: 'session.created',
			data: {
				harnessId: codexHarnessId,
				cwd: opts.cwd,
				nativeSessionId: resumeThreadId,
				capabilities: codexCapabilities,
			},
		});
	}

	void publishModels(emit);

	const runTurn = async (text: string): Promise<void> => {
		const abort = new AbortController();
		currentTurn = abort;
		try {
			const { events } = await thread.runStreamed(text, { signal: abort.signal });
			for await (const event of events) {
				const mapped = mapCodexEvent(state, event);
				state = mapped.state;
				for (const emitted of mapped.events) emit(emitted);
			}
		} catch (error) {
			if (disposed) return;
			if (abort.signal.aborted) {
				emit({ type: 'session.status', data: { status: 'idle', detail: 'interrupted' } });
				return;
			}
			emit({ type: 'session.status', data: { status: 'error', detail: describeError(error) } });
		} finally {
			if (currentTurn === abort) currentTurn = null;
		}
	};

	const rebuildThread = () => {
		const threadId = thread.id ?? state.threadId;
		thread = threadId ? codex.resumeThread(threadId, threadOptions) : codex.startThread(threadOptions);
	};

	return {
		async send(text, attachments = []) {
			// Codex takes a single prompt string, so an attachment travels as the path
			// its bytes are stored at and the model opens it with its own tools.
			const prompt = composeAttachmentPrompt(text, attachments);
			const echo = mapUserText(state, prompt, attachmentMetadata(attachments));
			state = echo.state;
			for (const event of echo.events) emit(event);
			// Codex owns one turn at a time; queueing keeps a second send from
			// racing the generator of the turn already in flight.
			turns = turns.then(() => runTurn(prompt));
		},

		async interrupt() {
			currentTurn?.abort();
			emit({ type: 'log', data: { level: 'info', message: 'interrupt requested' } });
		},

		respondToPermission(requestId) {
			emit({
				type: 'log',
				data: { level: 'debug', message: `codex does not request permissions; ignoring response to ${requestId}` },
			});
		},

		async setPermissionMode(mode) {
			if (!isSandboxMode(mode)) throw new Error(`unknown codex sandbox mode "${mode}"`);
			threadOptions = { ...threadOptions, sandboxMode: mode };
			rebuildThread();
			emit({ type: 'session.meta', data: { permissionMode: mode } });
		},

		async setModel(model) {
			const { model: _previous, ...rest } = threadOptions;
			threadOptions = model === codexDefaultModel.id ? rest : { ...rest, model };
			rebuildThread();
			emit({ type: 'session.meta', data: { model } });
		},

		async dispose() {
			disposed = true;
			currentTurn?.abort();
			await turns;
		},
	};
}

/**
 * The CLI caches the account's model list in `$CODEX_HOME/models_cache.json` and
 * exposes no query command, so an absent or unreadable cache simply leaves the
 * composer on the adapter's static list.
 */
async function publishModels(emit: EmitEvent): Promise<void> {
	const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
	try {
		const models = parseModelCache(await readFile(join(codexHome, 'models_cache.json'), 'utf8'));
		if (models.length === 0) return;
		emit({ type: 'session.meta', data: { models: [codexDefaultModel, ...models] } });
	} catch (error) {
		emit({ type: 'log', data: { level: 'debug', message: `codex model probe failed: ${describeError(error)}` } });
	}
}

function readSandboxMode(options: Record<string, unknown> | undefined): SandboxMode | null {
	const mode = options?.permissionMode;
	return typeof mode === 'string' && isSandboxMode(mode) ? mode : null;
}

function readModelOption(options: Record<string, unknown> | undefined): { model?: string } {
	const model = options?.model;
	if (typeof model !== 'string' || model === codexDefaultModel.id) return {};
	return { model };
}

function isSandboxMode(mode: string): mode is SandboxMode {
	return (sandboxModes as string[]).includes(mode);
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
