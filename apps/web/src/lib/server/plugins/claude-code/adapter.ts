import type {
	CanUseTool,
	Options,
	PermissionMode,
	PermissionResult,
	Query,
	SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { PermissionBehavior } from '@nib-ui/protocol';
import type { CreateSessionOptions, EmitEvent, HarnessAdapter, HarnessSession } from '../../services';
import { resolveClaudeExecutable } from './binary';
import { AsyncMessageQueue } from './message-queue';
import { ClaudeMessageMapper, claudeCodeCapabilities } from './mapping';

interface PermissionResponse {
	behavior: PermissionBehavior;
	updatedInput?: unknown;
}

interface ResumeOptions {
	nativeSessionId: string;
	fork?: boolean;
}

export function createClaudeCodeAdapter(): HarnessAdapter {
	return {
		id: 'claude-code',
		displayName: 'Claude Code',
		capabilities: claudeCodeCapabilities,
		createSession: (opts, emit) => startSession(opts, emit),
		resumeSession: (nativeSessionId, opts, emit) =>
			startSession(opts, emit, { nativeSessionId, fork: opts.fork }),
	};
}

async function startSession(
	opts: CreateSessionOptions,
	emit: EmitEvent,
	resume?: ResumeOptions,
): Promise<HarnessSession> {
	const executable = resolveClaudeExecutable();
	// Dynamic so the SDK never lands in a bundle that the client could pull in.
	const { query } = await import('@anthropic-ai/claude-agent-sdk');

	const queue = new AsyncMessageQueue<SDKUserMessage>();
	const abortController = new AbortController();
	const mapper = new ClaudeMessageMapper(emit, opts.cwd);
	const pending = new Map<string, (result: PermissionResult) => void>();
	const answeredEarly = new Map<string, PermissionResponse>();
	const answered = new Set<string>();
	let disposed = false;

	const canUseTool: CanUseTool = (toolName, input, options) => {
		const requestId = options.requestId;
		const early = answeredEarly.get(requestId);
		if (early) {
			answeredEarly.delete(requestId);
			return Promise.resolve(toPermissionResult(early));
		}
		// The resolver is registered before the event goes out: a transport that
		// answers synchronously (the smoke script, an auto-allow policy) would
		// otherwise resolve a request that has no pending entry yet.
		return new Promise<PermissionResult>((resolve) => {
			pending.set(requestId, resolve);
			emit({ type: 'session.status', data: { status: 'awaiting-permission' } });
			emit({
				type: 'permission.requested',
				data: { requestId, toolName, input, suggestions: options.suggestions },
				raw: describeRequest(options),
			});
		});
	};

	const session: Query = query({
		prompt: queue,
		options: {
			...(opts.options as Options),
			cwd: opts.cwd,
			abortController,
			includePartialMessages: true,
			pathToClaudeCodeExecutable: executable,
			canUseTool,
			...(resume ? { resume: resume.nativeSessionId, forkSession: resume.fork } : {}),
		},
	});

	const pump = (async () => {
		for await (const message of session) mapper.handle(message);
	})().catch((error: unknown) => {
		if (disposed) return;
		emit({ type: 'session.status', data: { status: 'error', detail: describeError(error) } });
	});

	return {
		async send(text) {
			mapper.emitUserText(text);
			queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
			emit({ type: 'session.status', data: { status: 'working' } });
		},

		async interrupt() {
			await session.interrupt();
			emit({ type: 'log', data: { level: 'info', message: 'interrupt requested' } });
		},

		respondToPermission(requestId, response) {
			if (answered.has(requestId)) return;
			answered.add(requestId);
			emit({
				type: 'permission.resolved',
				data: {
					requestId,
					behavior: response.behavior,
					updatedInput: response.updatedInput,
					resolvedBy: 'user',
				},
			});
			emit({ type: 'session.status', data: { status: 'working' } });

			const resolve = pending.get(requestId);
			if (!resolve) return void answeredEarly.set(requestId, response);
			pending.delete(requestId);
			resolve(toPermissionResult(response));
		},

		async setPermissionMode(mode) {
			await session.setPermissionMode(mode as PermissionMode);
			emit({ type: 'log', data: { level: 'info', message: `permission mode set to ${mode}` } });
		},

		async dispose() {
			disposed = true;
			queue.close();
			session.close();
			abortController.abort();
			await pump;
		},
	};
}

function toPermissionResult(response: PermissionResponse): PermissionResult {
	if (response.behavior === 'deny') return { behavior: 'deny', message: 'Denied by the user' };
	const updatedInput = response.updatedInput as Record<string, unknown> | undefined;
	return updatedInput ? { behavior: 'allow', updatedInput } : { behavior: 'allow' };
}

/** The raw options carry an AbortSignal, which cannot go into the JSONL log. */
function describeRequest(options: Parameters<CanUseTool>[2]): Record<string, unknown> {
	const { signal: _signal, ...rest } = options;
	return rest;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
