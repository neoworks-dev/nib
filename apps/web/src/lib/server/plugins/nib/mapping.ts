import type {
	EmittedEvent,
	HarnessCapabilities,
	MessageAttachment,
	ModelInfo,
	SlashCommandInfo,
} from '@nib-ui/protocol';

export const nibHarnessId = 'nib';

/**
 * nib gates each tool individually (`allow` / `ask` / `deny` in its config) rather
 * than putting the session into a mode, so `permissionModes` is empty and the
 * composer hides the picker. Everything else is a first-class route: `user.interrupt`,
 * `POST /fork`, `GET /commands`, `GET /models`, `thinkingLevel`, and checkpoints.
 */
export const nibCapabilities: HarnessCapabilities = {
	interrupt: true,
	permissionModes: [],
	resume: true,
	fork: true,
	slashCommands: true,
	models: true,
	effortLevels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
	checkpoints: true,
};

/** Selecting this leaves `provider` and `model` off the create call, so nib keeps its own default. */
export const nibDefaultModel: ModelInfo = {
	id: 'default',
	displayName: 'Default',
	description: 'Provider and model configured in ~/.nib/config.json',
};

/** Composer pre-flight only; `GET /v1/models` replaces this once the server answers. */
export const nibModels: ModelInfo[] = [nibDefaultModel];

export interface NibStreamState {
	readonly cwd: string;
	readonly nativeSessionId: string | null;
	/** Base url of the nib server, used to address blobs referenced by a message. */
	readonly baseUrl: string;
	readonly messageId: string | null;
	readonly messageStopReason: string | null;
	readonly assistantMessages: number;
	readonly userMessages: number;
	readonly startedBlocks: readonly string[];
	/** Which message a tool call belongs to, so its result lands in the same one. */
	readonly toolMessages: Readonly<Record<string, string>>;
	readonly toolNames: Readonly<Record<string, string>>;
	/** Transcript seq each assistant message opened at; a checkpoint is keyed by seq. */
	readonly messageStartSeqs: readonly { readonly messageId: string; readonly seq: number }[];
	readonly checkpointed: readonly string[];
	/**
	 * nib echoes a prompt back through its transcript rather than accepting our own,
	 * so what was attached to each posted message waits here in send order until the
	 * matching `user.message` comes round.
	 */
	readonly pendingAttachments: readonly MessageAttachment[][];
}

export interface NibMapResult {
	state: NibStreamState;
	events: EmittedEvent[];
}

export function createNibStreamState(cwd: string, baseUrl: string, nativeSessionId: string | null = null): NibStreamState {
	return {
		cwd,
		nativeSessionId,
		baseUrl,
		messageId: null,
		messageStopReason: null,
		assistantMessages: 0,
		userMessages: 0,
		startedBlocks: [],
		toolMessages: {},
		toolNames: {},
		messageStartSeqs: [],
		checkpointed: [],
		pendingAttachments: [],
	};
}

/** Records what the next posted `user.message` carries, for the echo to pick up. */
export function queueUserAttachments(state: NibStreamState, attachments: MessageAttachment[]): NibStreamState {
	return { ...state, pendingAttachments: [...state.pendingAttachments, attachments] };
}

/**
 * Translates one nib transcript event into normalized events.
 *
 * Every branch narrows from `unknown`: the payload crosses an HTTP boundary, so a
 * truncated or unrecognized frame has to degrade into a log or an `ext` passthrough
 * rather than throw and kill the stream reader.
 */
export function mapNibEvent(state: NibStreamState, event: unknown): NibMapResult {
	if (!isRecord(event) || typeof event.type !== 'string') {
		return { state, events: [{ type: 'log', data: { level: 'warn', message: 'nib emitted an unreadable event' }, raw: event }] };
	}

	switch (event.type) {
		case 'user.message':
			return mapUserMessage(state, event, 'user');
		// Context authored by the embedding app rather than its user. nib wraps it with a
		// provenance label before dispatch; the label rides along in `raw` because the
		// projection has only `user` and `assistant` to place it under.
		case 'app.message':
			return mapUserMessage(state, event, 'app');

		case 'session.status_running':
			return { state, events: [{ type: 'session.status', data: { status: 'working' }, raw: event }] };

		case 'session.status_idle':
			return mapIdle(state, event);

		case 'session.status_terminated':
			return {
				state: closeMessage(state),
				events: [
					...completeMessage(state),
					{
						type: 'session.status',
						data: { status: 'closed', detail: readString(event.reason) },
						raw: event,
					},
				],
			};

		case 'agent.message_start': {
			const messageId = `assistant-${state.assistantMessages + 1}`;
			return {
				state: {
					...closeMessage(state),
					messageId,
					assistantMessages: state.assistantMessages + 1,
					messageStartSeqs: [...state.messageStartSeqs, { messageId, seq: readNumber(event.seq) }],
				},
				events: [
					...completeMessage(state),
					{ type: 'message.started', data: { messageId, role: 'assistant' }, raw: event },
				],
			};
		}

		case 'agent.thinking_delta':
			return mapDelta(state, event, 'thinking');

		case 'agent.message_delta':
			return mapDelta(state, event, 'text');

		case 'agent.message_end':
			return mapMessageEnd(state, event);

		// The block itself already arrived inside `agent.message_end`; what is new here is
		// whether the call is blocked on a human.
		case 'agent.tool_use': {
			if (event.permission !== 'ask') return { state, events: [] };
			const toolUseId = readString(event.toolUseId);
			if (toolUseId === undefined) return { state, events: [] };
			return {
				state,
				events: [
					{
						type: 'permission.requested',
						data: { requestId: toolUseId, toolName: readString(event.name) ?? 'unknown', input: event.input },
						raw: event,
					},
				],
			};
		}

		case 'agent.tool_use_edited': {
			const toolUseId = readString(event.toolUseId);
			if (toolUseId === undefined) return { state, events: [] };
			const blockId = `tool-${toolUseId}`;
			if (!state.startedBlocks.includes(blockId)) return { state, events: [] };
			return {
				state,
				events: [
					{
						type: 'block.completed',
						data: {
							blockId,
							content: { kind: 'tool_use', toolName: readString(event.name) ?? 'unknown', toolUseId, input: event.input },
						},
						raw: event,
					},
				],
			};
		}

		case 'agent.tool_result':
			return mapToolResult(state, event);

		case 'agent.tool_progress':
			return {
				state,
				events: [{ type: 'ext', data: { ns: nibHarnessId, type: 'tool_progress', data: event }, raw: event }],
			};

		case 'user.tool_confirmation': {
			const toolUseId = readString(event.toolUseId);
			if (toolUseId === undefined) return { state, events: [] };
			return {
				state,
				events: [
					{
						type: 'permission.resolved',
						data: {
							requestId: toolUseId,
							behavior: event.result === 'deny' ? 'deny' : 'allow',
							updatedInput: event.input,
							resolvedBy: 'user',
						},
						raw: event,
					},
				],
			};
		}

		// Not fatal on its own: nib also reports a refused edit or a rejected argument
		// replacement this way, and the call it describes is still pending.
		case 'session.error':
			return {
				state,
				events: [{ type: 'log', data: { level: 'error', message: readString(event.message) ?? 'nib error' }, raw: event }],
			};

		case 'session.notice':
			return {
				state,
				events: [{ type: 'log', data: { level: 'info', message: readString(event.message) ?? '' }, raw: event }],
			};

		case 'session.compacted':
			return {
				state,
				events: [
					{
						type: 'log',
						data: {
							level: 'info',
							message: `compacted history, dropping ${readNumber(event.droppedMessages)} message(s)`,
						},
						raw: event,
					},
					{ type: 'ext', data: { ns: nibHarnessId, type: 'compacted', data: event }, raw: event },
				],
			};

		// Carried through so a client can react, but neither changes the projection: a
		// branch marker only moves nib's head, and a fork is a session of its own.
		case 'session.branched':
		case 'session.forked':
		case 'session.shell_result':
		case 'session.info_changed':
		case 'user.branch':
		case 'user.shell':
		case 'user.command':
		case 'user.compact':
		case 'user.unqueue':
		case 'user.interrupt':
		case 'user.tool_result':
			return {
				state,
				events: [{ type: 'ext', data: { ns: nibHarnessId, type: event.type, data: event }, raw: event }],
			};

		default:
			return {
				state,
				events: [{ type: 'ext', data: { ns: nibHarnessId, type: event.type, data: event }, raw: event }],
			};
	}
}

/**
 * A checkpoint is keyed by the seq of the `agent.tool_use` that was about to write,
 * so it belongs to the last assistant message that opened at or before it. Only the
 * earliest per message is announced: restoring that one already undoes the later ones.
 */
export function mapCheckpoints(state: NibStreamState, checkpoints: unknown): NibMapResult {
	const seqs = readCheckpointSeqs(checkpoints);
	if (seqs.length === 0) return { state, events: [] };

	const earliest = new Map<string, number>();
	for (const seq of seqs) {
		const owner = [...state.messageStartSeqs].reverse().find((entry) => entry.seq <= seq);
		if (!owner || state.checkpointed.includes(owner.messageId)) continue;
		const current = earliest.get(owner.messageId);
		if (current === undefined || seq < current) earliest.set(owner.messageId, seq);
	}
	if (earliest.size === 0) return { state, events: [] };

	return {
		state: { ...state, checkpointed: [...state.checkpointed, ...earliest.keys()] },
		events: [...earliest].map(([messageId, seq]) => ({
			type: 'message.checkpoint' as const,
			data: { messageId, checkpointId: String(seq) },
		})),
	};
}

function readCheckpointSeqs(payload: unknown): number[] {
	if (!isRecord(payload) || !Array.isArray(payload.checkpoints)) return [];
	return payload.checkpoints
		.filter(isRecord)
		.map((entry) => entry.seq)
		.filter((seq): seq is number => typeof seq === 'number' && Number.isFinite(seq));
}

/** nib reports slash commands per server, not per session; the shape already matches. */
export function parseCommands(payload: unknown): SlashCommandInfo[] {
	if (!isRecord(payload) || !Array.isArray(payload.commands)) return [];
	const commands: SlashCommandInfo[] = [];
	for (const entry of payload.commands) {
		if (!isRecord(entry) || typeof entry.name !== 'string') continue;
		commands.push({
			name: entry.name,
			description: readString(entry.description),
			argumentHint: readString(entry.argumentHint),
		});
	}
	return commands;
}

/**
 * `GET /v1/models` groups models by provider, and nib needs both halves to switch.
 * The composer carries one string per model, so the pair is flattened to
 * `provider/model` and split again on the way back out.
 */
export function parseModels(payload: unknown): ModelInfo[] {
	if (!isRecord(payload) || !Array.isArray(payload.providers)) return [];
	const models: ModelInfo[] = [nibDefaultModel];
	for (const group of payload.providers) {
		if (!isRecord(group) || typeof group.provider !== 'string' || !Array.isArray(group.models)) continue;
		for (const model of group.models) {
			if (!isRecord(model) || typeof model.id !== 'string') continue;
			models.push({
				id: `${group.provider}/${model.id}`,
				displayName: readString(model.displayName) ?? model.id,
				description: `${group.provider}${model.description === undefined ? '' : ` — ${String(model.description)}`}`,
			});
		}
	}
	return models;
}

export function splitModelId(id: string): { provider?: string; model?: string } {
	if (id === nibDefaultModel.id) return {};
	const separator = id.indexOf('/');
	if (separator < 0) return { model: id };
	return { provider: id.slice(0, separator), model: id.slice(separator + 1) };
}

function mapUserMessage(state: NibStreamState, event: Record<string, unknown>, kind: 'user' | 'app'): NibMapResult {
	const messageId = `user-${state.userMessages + 1}`;
	const blocks = kind === 'app' ? [{ type: 'text', text: readString(event.text) ?? '' }] : event.content;
	const echoed = kind === 'user' && state.pendingAttachments.length > 0;
	const pendingAttachments = echoed ? state.pendingAttachments.slice(1) : state.pendingAttachments;
	const queued = echoed ? state.pendingAttachments[0]! : [];
	const attachments = queued.length > 0 ? queued : undefined;
	const events: EmittedEvent[] = [
		...completeMessage(state),
		{ type: 'message.started', data: { messageId, role: 'user', attachments }, raw: event },
	];

	const contents = Array.isArray(blocks) ? blocks : [];
	contents.forEach((block, index) => {
		if (!isRecord(block)) return;
		const blockId = `${messageId}:${index}`;
		const content = toUserBlockContent(state, block);
		if (!content) return;
		events.push({ type: 'block.started', data: { messageId, blockId, kind: content.kind } });
		events.push({ type: 'block.completed', data: { blockId, content } });
	});

	events.push({ type: 'message.completed', data: { messageId } });
	return { state: { ...closeMessage(state), userMessages: state.userMessages + 1, pendingAttachments }, events };
}

/** Image bytes stay in nib's blob store; only the ref travels in its transcript. */
function toUserBlockContent(state: NibStreamState, block: Record<string, unknown>) {
	if (block.type === 'text') return { kind: 'text' as const, text: readString(block.text) ?? '' };
	if (block.type !== 'image') return null;
	const ref = readString(block.ref);
	if (ref === undefined || state.nativeSessionId === null) return null;
	return {
		kind: 'image' as const,
		mediaType: readString(block.mediaType) ?? 'application/octet-stream',
		url: `${state.baseUrl}/v1/sessions/${state.nativeSessionId}/blobs/${ref}`,
	};
}

function mapDelta(state: NibStreamState, event: Record<string, unknown>, kind: 'text' | 'thinking'): NibMapResult {
	const opened = ensureMessage(state);
	const blockId = `${opened.messageId}:${kind}`;
	const started = openBlock(opened.state, opened.messageId, blockId, { kind }, event);
	return {
		state: started.state,
		events: [
			...opened.events,
			...started.events,
			{ type: 'block.delta', data: { blockId, textDelta: readString(event.text) ?? '' } },
		],
	};
}

/**
 * The assembled blocks arrive here, so the streamed text and thinking blocks are
 * closed with their final content and every tool call in the message is announced.
 * The message itself stays open: its tool results are still to come, and they belong
 * to the turn that asked for them.
 */
function mapMessageEnd(state: NibStreamState, event: Record<string, unknown>): NibMapResult {
	const opened = ensureMessage(state);
	const messageId = opened.messageId;
	let next = opened.state;
	const events = [...opened.events];
	const content = Array.isArray(event.content) ? event.content : [];

	for (const block of content) {
		if (!isRecord(block)) continue;

		if (block.type === 'text' || block.type === 'thinking') {
			const kind = block.type;
			const blockId = `${messageId}:${kind}`;
			const started = openBlock(next, messageId, blockId, { kind }, event);
			next = started.state;
			events.push(...started.events, {
				type: 'block.completed',
				data: { blockId, content: { kind, text: readString(block.text) ?? '' } },
			});
			continue;
		}

		if (block.type !== 'tool_use') continue;
		const toolUseId = readString(block.id);
		if (toolUseId === undefined) continue;
		const toolName = readString(block.name) ?? 'unknown';
		const blockId = `tool-${toolUseId}`;
		const started = openBlock(next, messageId, blockId, { kind: 'tool_use', toolName, toolUseId }, event);
		next = {
			...started.state,
			toolMessages: { ...started.state.toolMessages, [toolUseId]: messageId },
			toolNames: { ...started.state.toolNames, [toolUseId]: toolName },
		};
		events.push(...started.events, {
			type: 'block.completed',
			data: { blockId, content: { kind: 'tool_use', toolName, toolUseId, input: block.input } },
		});
	}

	return { state: { ...next, messageStopReason: readString(event.stopReason) ?? null }, events };
}

function mapToolResult(state: NibStreamState, event: Record<string, unknown>): NibMapResult {
	const toolUseId = readString(event.toolUseId);
	if (toolUseId === undefined) return { state, events: [] };

	// A result whose call was never announced still has to land somewhere, so it
	// attaches to the open message rather than being dropped.
	const opened = state.toolMessages[toolUseId] === undefined ? ensureMessage(state) : null;
	const messageId = state.toolMessages[toolUseId] ?? opened?.messageId;
	if (messageId === undefined) return { state, events: [] };

	const blockId = `tool-${toolUseId}:result`;
	const toolName = state.toolNames[toolUseId] ?? readString(event.name) ?? 'unknown';
	const started = openBlock(opened?.state ?? state, messageId, blockId, { kind: 'tool_result', toolName, toolUseId }, event);

	return {
		state: started.state,
		events: [
			...(opened?.events ?? []),
			...started.events,
			{
				type: 'block.completed',
				data: {
					blockId,
					content: { kind: 'tool_result', toolUseId, output: event.content, isError: event.isError === true },
				},
				raw: event,
			},
		],
	};
}

/**
 * `requires_action` is nib going idle *while waiting for a human*, not the turn
 * ending — treating it as finished is the one thing its protocol asks a renderer
 * not to do, so it maps to `awaiting-permission` and leaves the message open.
 */
function mapIdle(state: NibStreamState, event: Record<string, unknown>): NibMapResult {
	const stopReason = readString(event.stopReason);
	if (stopReason === 'requires_action') {
		return { state, events: [{ type: 'session.status', data: { status: 'awaiting-permission' }, raw: event }] };
	}

	const status = stopReason === 'error' ? 'error' : 'idle';
	return {
		state: closeMessage(state),
		events: [
			...completeMessage(state),
			{
				type: 'session.status',
				data: { status, detail: stopReason === 'aborted' ? 'interrupted' : undefined },
				raw: event,
			},
		],
	};
}

function ensureMessage(state: NibStreamState): { state: NibStreamState; events: EmittedEvent[]; messageId: string } {
	if (state.messageId !== null) return { state, events: [], messageId: state.messageId };
	const messageId = `assistant-${state.assistantMessages + 1}`;
	return {
		state: { ...state, messageId, assistantMessages: state.assistantMessages + 1 },
		events: [{ type: 'message.started', data: { messageId, role: 'assistant' } }],
		messageId,
	};
}

function completeMessage(state: NibStreamState): EmittedEvent[] {
	if (state.messageId === null) return [];
	return [
		{
			type: 'message.completed',
			data: { messageId: state.messageId, stopReason: state.messageStopReason ?? undefined },
		},
	];
}

function closeMessage(state: NibStreamState): NibStreamState {
	return { ...state, messageId: null, messageStopReason: null };
}

interface BlockDescriptor {
	kind: 'text' | 'thinking' | 'tool_use' | 'tool_result';
	toolName?: string;
	toolUseId?: string;
}

/** Announces a block at most once: a delta and the assembled content share an id. */
function openBlock(
	state: NibStreamState,
	messageId: string,
	blockId: string,
	descriptor: BlockDescriptor,
	raw: unknown,
): { state: NibStreamState; events: EmittedEvent[] } {
	if (state.startedBlocks.includes(blockId)) return { state, events: [] };
	return {
		state: { ...state, startedBlocks: [...state.startedBlocks, blockId] },
		events: [{ type: 'block.started', data: { messageId, blockId, ...descriptor }, raw }],
	};
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
