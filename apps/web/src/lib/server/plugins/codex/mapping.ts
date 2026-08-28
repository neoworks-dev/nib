import type { BlockKind, EmittedEvent, HarnessCapabilities, MessageAttachment, ModelInfo } from '@nib-ui/protocol';

export const codexHarnessId = 'codex';

/**
 * `codex exec` runs without an interactive approval channel: the sandbox policy
 * is fixed for the process and the model is told to proceed, so what the UI
 * calls a permission mode is Codex's sandbox mode and `permission.requested` is
 * never emitted. There is no fork API and no slash commands outside the TUI.
 */
export const codexCapabilities: HarnessCapabilities = {
	interrupt: true,
	permissionModes: ['read-only', 'workspace-write', 'danger-full-access'],
	resume: true,
	fork: false,
	slashCommands: false,
	models: true,
};

/** Selecting this leaves `--model` off, so the CLI keeps whatever `config.toml` sets. */
export const codexDefaultModel: ModelInfo = {
	id: 'default',
	displayName: 'Default',
	description: 'Model configured in ~/.codex/config.toml',
};

/** Composer pre-flight only; the account's real list replaces this at session start. */
export const codexModels: ModelInfo[] = [
	codexDefaultModel,
	{ id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol' },
	{ id: 'gpt-5.5', displayName: 'GPT-5.5' },
	{ id: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini' },
];

export interface CodexStreamState {
	readonly cwd: string;
	readonly threadId: string | null;
	readonly messageId: string | null;
	readonly turns: number;
	readonly userMessages: number;
	/** Characters already streamed per item id, so `item.updated` emits only the suffix. */
	readonly streamedText: Readonly<Record<string, number>>;
	readonly startedBlocks: readonly string[];
	readonly totals: { readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens: number };
}

export interface CodexMapResult {
	state: CodexStreamState;
	events: EmittedEvent[];
}

export function createCodexStreamState(cwd: string, threadId: string | null = null): CodexStreamState {
	return {
		cwd,
		threadId,
		messageId: null,
		turns: 0,
		userMessages: 0,
		streamedText: {},
		startedBlocks: [],
		totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
	};
}

/** Local echo of text handed to the CLI: Codex never replays the prompt back on the stream. */
export function mapUserText(
	state: CodexStreamState,
	text: string,
	attachments?: MessageAttachment[],
): CodexMapResult {
	const messageId = `user-${state.userMessages + 1}`;
	const blockId = `${messageId}:0`;
	return {
		state: { ...state, userMessages: state.userMessages + 1 },
		events: [
			{ type: 'message.started', data: { messageId, role: 'user', attachments } },
			{ type: 'block.started', data: { messageId, blockId, kind: 'text' } },
			{ type: 'block.completed', data: { blockId, content: { kind: 'text', text } } },
			{ type: 'message.completed', data: { messageId } },
			{ type: 'session.status', data: { status: 'working' } },
		],
	};
}

/**
 * Translates one Codex JSONL event into normalized events. Every branch narrows
 * from `unknown`: the payload crosses a subprocess boundary, so a truncated or
 * unrecognized line has to degrade into a log or an `ext` passthrough instead of
 * throwing and killing the read loop.
 */
export function mapCodexEvent(state: CodexStreamState, event: unknown): CodexMapResult {
	if (!isRecord(event) || typeof event.type !== 'string') {
		return { state, events: [unreadable('codex emitted an unreadable event', event)] };
	}

	switch (event.type) {
		case 'thread.started': {
			const threadId = typeof event.thread_id === 'string' ? event.thread_id : null;
			// Every turn is a fresh process, so the same thread is announced again each
			// time; only the first announcement carries new information.
			if (threadId && threadId === state.threadId) return { state, events: [] };
			return {
				state: { ...state, threadId: threadId ?? state.threadId },
				events: [
					{
						type: 'session.created',
						data: {
							harnessId: codexHarnessId,
							cwd: state.cwd,
							nativeSessionId: threadId ?? undefined,
							capabilities: codexCapabilities,
						},
						raw: event,
					},
				],
			};
		}

		case 'turn.started': {
			const messageId = `turn-${state.turns + 1}`;
			return {
				state: { ...state, turns: state.turns + 1, messageId },
				events: [
					{ type: 'message.started', data: { messageId, role: 'assistant' }, raw: event },
					{ type: 'session.status', data: { status: 'working' } },
				],
			};
		}

		case 'turn.completed': {
			const totals = addUsage(state.totals, event.usage);
			const events: EmittedEvent[] = [{ type: 'usage.updated', data: { ...totals }, raw: event }];
			if (state.messageId) events.push({ type: 'message.completed', data: { messageId: state.messageId } });
			events.push({ type: 'session.status', data: { status: 'idle' } });
			return { state: { ...closeTurn(state), totals }, events };
		}

		case 'turn.failed': {
			const events: EmittedEvent[] = [];
			if (state.messageId) {
				events.push({ type: 'message.completed', data: { messageId: state.messageId, stopReason: 'error' } });
			}
			events.push({
				type: 'session.status',
				data: { status: 'error', detail: readMessage(event.error) ?? 'turn failed' },
				raw: event,
			});
			return { state: closeTurn(state), events };
		}

		case 'error':
			return {
				state,
				events: [
					{
						type: 'session.status',
						data: { status: 'error', detail: typeof event.message === 'string' ? event.message : 'codex error' },
						raw: event,
					},
				],
			};

		case 'item.started':
		case 'item.updated':
		case 'item.completed':
			return mapItem(state, event, event.type);

		default:
			return { state, events: [{ type: 'ext', data: { ns: codexHarnessId, type: event.type, data: event }, raw: event }] };
	}
}

/** `visibility: "hide"` entries are internal Codex routing targets, not user choices. */
export function parseModelCache(raw: string): ModelInfo[] {
	const parsed: unknown = JSON.parse(raw);
	if (!isRecord(parsed) || !Array.isArray(parsed.models)) return [];
	const models: ModelInfo[] = [];
	for (const entry of parsed.models) {
		if (!isRecord(entry) || typeof entry.slug !== 'string') continue;
		if (entry.visibility !== 'list') continue;
		models.push({
			id: entry.slug,
			displayName: typeof entry.display_name === 'string' ? entry.display_name : entry.slug,
			description: typeof entry.description === 'string' ? entry.description : undefined,
		});
	}
	return models;
}

type ItemPhase = 'item.started' | 'item.updated' | 'item.completed';

function mapItem(state: CodexStreamState, event: Record<string, unknown>, phase: ItemPhase): CodexMapResult {
	const item = event.item;
	if (!isRecord(item) || typeof item.id !== 'string' || typeof item.type !== 'string') {
		return { state, events: [unreadable('codex emitted an item without an id or type', event)] };
	}

	// A non-fatal error item is a diagnostic about the turn, not conversation content.
	if (item.type === 'error') {
		if (phase !== 'item.completed') return { state, events: [] };
		const message = typeof item.message === 'string' ? item.message : 'codex reported an error';
		return { state, events: [{ type: 'log', data: { level: 'error', message }, raw: event }] };
	}

	const textKind = textBlockKinds[item.type];
	if (textKind) return mapTextItem(state, event, item, phase, textKind);
	return mapToolItem(state, event, item, phase);
}

const textBlockKinds: Record<string, BlockKind | undefined> = {
	agent_message: 'text',
	reasoning: 'thinking',
};

function mapTextItem(
	state: CodexStreamState,
	event: Record<string, unknown>,
	item: Record<string, unknown>,
	phase: ItemPhase,
	kind: BlockKind,
): CodexMapResult {
	const text = typeof item.text === 'string' ? item.text : '';
	const message = ensureMessage(state);
	const blockId = qualify(message.messageId, item.id as string);
	const opened = openBlock(message.state, message.messageId, blockId, { kind }, event);
	let next = opened.state;
	const events = [...message.events, ...opened.events];

	if (phase === 'item.completed') {
		events.push({ type: 'block.completed', data: { blockId, content: { kind, text } }, raw: event });
		return { state: next, events };
	}

	// Codex resends the whole text on every update; only the unseen tail is new.
	const alreadyStreamed = next.streamedText[blockId] ?? 0;
	if (text.length > alreadyStreamed) {
		events.push({ type: 'block.delta', data: { blockId, textDelta: text.slice(alreadyStreamed) } });
		next = { ...next, streamedText: { ...next.streamedText, [blockId]: text.length } };
	}
	return { state: next, events };
}

function mapToolItem(
	state: CodexStreamState,
	event: Record<string, unknown>,
	item: Record<string, unknown>,
	phase: ItemPhase,
): CodexMapResult {
	const { toolName, input } = describeTool(item);
	const message = ensureMessage(state);
	const toolUseId = qualify(message.messageId, item.id as string);
	const opened = openBlock(message.state, message.messageId, toolUseId, { kind: 'tool_use', toolName, toolUseId }, event);
	const events = [...message.events, ...opened.events];

	// Re-sent on every phase because a todo list rewrites its own input as it advances.
	events.push({
		type: 'block.completed',
		data: { blockId: toolUseId, content: { kind: 'tool_use', toolName, toolUseId, input } },
		raw: event,
	});

	const outcome = phase === 'item.completed' ? describeToolOutcome(item) : null;
	if (!outcome) return { state: opened.state, events };

	const resultBlockId = `${toolUseId}:result`;
	const result = openBlock(
		opened.state,
		message.messageId,
		resultBlockId,
		{ kind: 'tool_result', toolName, toolUseId },
		event,
	);
	events.push(...result.events, {
		type: 'block.completed',
		data: { blockId: resultBlockId, content: { kind: 'tool_result', toolUseId, ...outcome } },
		raw: event,
	});
	return { state: result.state, events };
}

function describeTool(item: Record<string, unknown>): { toolName: string; input: unknown } {
	switch (item.type) {
		case 'command_execution':
			return { toolName: 'shell', input: { command: item.command } };
		case 'file_change':
			return { toolName: 'apply_patch', input: { changes: item.changes } };
		case 'mcp_tool_call':
			return { toolName: `mcp__${String(item.server)}__${String(item.tool)}`, input: item.arguments };
		case 'web_search':
			return { toolName: 'web_search', input: { query: item.query } };
		case 'todo_list':
			return { toolName: 'todo_list', input: { items: item.items } };
		default:
			return { toolName: item.type as string, input: item };
	}
}

/** Returns null for items that never carry a result, so no empty result block is invented. */
function describeToolOutcome(item: Record<string, unknown>): { output: unknown; isError: boolean } | null {
	switch (item.type) {
		case 'command_execution':
			return {
				output: item.aggregated_output ?? '',
				isError: item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0),
			};
		case 'file_change':
			return { output: { changes: item.changes }, isError: item.status === 'failed' };
		case 'mcp_tool_call':
			return { output: item.error ?? item.result, isError: item.status === 'failed' };
		default:
			return null;
	}
}

interface BlockDescriptor {
	kind: BlockKind;
	toolName?: string;
	toolUseId?: string;
}

/**
 * Item ids restart at `item_0` on every turn — the SDK spawns a fresh
 * `codex exec` per turn — so a block id has to carry the message it belongs to.
 */
function qualify(messageId: string, itemId: string): string {
	return `${messageId}:${itemId}`;
}

/** An `item.completed` can arrive with no preceding `turn.started`; the message is synthesized. */
function ensureMessage(state: CodexStreamState): {
	state: CodexStreamState;
	events: EmittedEvent[];
	messageId: string;
} {
	if (state.messageId) return { state, events: [], messageId: state.messageId };
	const messageId = `turn-${state.turns + 1}`;
	return {
		state: { ...state, turns: state.turns + 1, messageId },
		events: [{ type: 'message.started', data: { messageId, role: 'assistant' } }],
		messageId,
	};
}

/** Announces a block at most once; later phases of the same item reuse the id. */
function openBlock(
	state: CodexStreamState,
	messageId: string,
	blockId: string,
	descriptor: BlockDescriptor,
	raw: unknown,
): { state: CodexStreamState; events: EmittedEvent[] } {
	if (state.startedBlocks.includes(blockId)) return { state, events: [] };
	return {
		state: { ...state, startedBlocks: [...state.startedBlocks, blockId] },
		events: [{ type: 'block.started', data: { messageId, blockId, ...descriptor }, raw }],
	};
}

/** Per-turn bookkeeping cannot outlive the turn, since the next one reuses the item ids. */
function closeTurn(state: CodexStreamState): CodexStreamState {
	return { ...state, messageId: null, startedBlocks: [], streamedText: {} };
}

function addUsage(totals: CodexStreamState['totals'], usage: unknown): CodexStreamState['totals'] {
	if (!isRecord(usage)) return totals;
	return {
		inputTokens: totals.inputTokens + readNumber(usage.input_tokens),
		outputTokens: totals.outputTokens + readNumber(usage.output_tokens),
		cacheReadTokens: totals.cacheReadTokens + readNumber(usage.cached_input_tokens),
	};
}

function unreadable(message: string, raw: unknown): EmittedEvent {
	return { type: 'log', data: { level: 'warn', message }, raw };
}

function readMessage(error: unknown): string | undefined {
	if (!isRecord(error)) return undefined;
	return typeof error.message === 'string' ? error.message : undefined;
}

function readNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
