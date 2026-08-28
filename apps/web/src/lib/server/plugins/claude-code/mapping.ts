import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
	BlockContent,
	BlockKind,
	HarnessCapabilities,
	MessageAttachment,
	MessageRole,
	ModelInfo,
} from '@nib-ui/protocol';
import type { EmitEvent } from '../../services';

export const claudeCodeCapabilities: HarnessCapabilities = {
	interrupt: true,
	permissionModes: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
	resume: true,
	fork: true,
	slashCommands: true,
	models: true,
	effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
	checkpoints: true,
};

/**
 * The CLI's stable `--model` aliases. `supportedModels()` replaces these with
 * resolved display names once the process answers its first control request.
 */
export const claudeCodeModels: ModelInfo[] = [
	{ id: 'default', displayName: 'Default' },
	{ id: 'opus', displayName: 'Opus' },
	{ id: 'sonnet', displayName: 'Sonnet' },
	{ id: 'haiku', displayName: 'Haiku' },
];

type RawBlock = { type: string; [key: string]: unknown };

type StreamEvent = {
	type: string;
	index?: number;
	message?: { id?: string };
	content_block?: RawBlock;
	delta?: RawBlock;
};

interface StreamedBlock {
	blockId: string;
	kind: BlockKind;
	toolUseId: string | null;
}

/**
 * Translates the SDK message stream into normalized events. Streamed block
 * events and the final assistant message describe the same blocks, so streamed
 * ids are matched back by kind (and tool_use id) rather than by index: with
 * `includePartialMessages` the CLI may deliver one assistant message per block,
 * where the final message's own indices restart at zero.
 */
export class ClaudeMessageMapper {
	nativeSessionId: string | null = null;
	private currentMessageId: string | null = null;
	private readonly startedMessages = new Set<string>();
	private readonly openMessages = new Set<string>();
	private readonly pendingBlocks = new Map<string, StreamedBlock[]>();
	private readonly expectedEchoes: { text: string; messageId: string }[] = [];
	/** Lets a tool_result block carry the tool name, which renderers resolve on. */
	private readonly toolNamesByUseId = new Map<string, string>();
	private readonly totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
	private synthesizedBlocks = 0;

	constructor(
		private readonly emit: EmitEvent,
		private readonly cwd: string,
	) {}

	handle(message: SDKMessage): void {
		// `/clear` makes the CLI announce a new conversation; the projection follows.
		if ((message.type as string) === 'conversation_reset') {
			this.emit({ type: 'session.cleared', data: { reason: 'conversation_reset' }, raw: message });
			return;
		}
		switch (message.type) {
			case 'system':
				return this.handleSystem(message);
			case 'stream_event':
				return this.handleStreamEvent(message);
			case 'assistant':
				return this.handleAssistant(message);
			case 'user':
				return this.handleUser(message);
			case 'result':
				return this.handleResult(message);
			default:
				return this.passthrough(message);
		}
	}

	/**
	 * The local echo of text we pushed into the input queue, so the UI shows it
	 * immediately. `messageId` is the uuid the prompt carries into the CLI, which
	 * is also what `rewindFiles` restores to — the CLI does not echo prompts back
	 * in streaming input mode, so waiting for one would never yield a checkpoint.
	 */
	emitUserText(text: string, messageId: string, attachments?: MessageAttachment[]): void {
		const blockId = `${messageId}:0`;
		this.expectedEchoes.push({ text, messageId });
		this.emit({ type: 'message.started', data: { messageId, role: 'user', attachments } });
		this.emit({ type: 'block.started', data: { messageId, blockId, kind: 'text' } });
		this.emit({ type: 'block.completed', data: { blockId, content: { kind: 'text', text } } });
		this.emit({ type: 'message.completed', data: { messageId } });
		this.emit({ type: 'message.checkpoint', data: { messageId, checkpointId: messageId } });
	}

	private handleSystem(message: Extract<SDKMessage, { type: 'system' }>): void {
		if (message.subtype !== 'init') return this.passthrough(message);
		this.nativeSessionId = message.session_id;
		this.emit({
			type: 'session.created',
			data: {
				harnessId: 'claude-code',
				cwd: message.cwd ?? this.cwd,
				nativeSessionId: message.session_id,
				capabilities: {
					...claudeCodeCapabilities,
					slashCommands: (message.slash_commands?.length ?? 0) > 0,
				},
			},
			raw: message,
		});
	}

	private handleStreamEvent(message: Extract<SDKMessage, { type: 'stream_event' }>): void {
		const event = message.event as StreamEvent;
		switch (event.type) {
			case 'message_start':
				return this.beginMessage(event.message?.id ?? crypto.randomUUID(), 'assistant');
			case 'content_block_start':
				return this.beginStreamedBlock(event, message);
			case 'content_block_delta':
				return this.applyDelta(event);
			case 'content_block_stop':
			case 'message_delta':
			case 'message_stop':
				return;
			default:
				return this.passthrough(message);
		}
	}

	private beginStreamedBlock(event: StreamEvent, raw: unknown): void {
		const messageId = this.currentMessageId ?? this.beginSyntheticMessage();
		const block = event.content_block ?? { type: 'text' };
		const blockId = `${messageId}:${event.index ?? 0}`;
		const streamed: StreamedBlock = {
			blockId,
			kind: mapBlockKind(block.type),
			toolUseId: typeof block.id === 'string' ? block.id : null,
		};
		this.trackBlock(messageId, streamed);
		this.emit({
			type: 'block.started',
			data: {
				messageId,
				blockId,
				kind: streamed.kind,
				toolName: this.toolNameFor(block),
				toolUseId: streamed.toolUseId ?? undefined,
			},
			raw,
		});
	}

	private applyDelta(event: StreamEvent): void {
		const messageId = this.currentMessageId;
		if (!messageId || !event.delta) return;
		const blockId = `${messageId}:${event.index ?? 0}`;
		const { type, text, thinking, partial_json: partialJson } = event.delta;
		if (type === 'text_delta' && typeof text === 'string') {
			return this.emit({ type: 'block.delta', data: { blockId, textDelta: text } });
		}
		if (type === 'thinking_delta' && typeof thinking === 'string') {
			return this.emit({ type: 'block.delta', data: { blockId, textDelta: thinking } });
		}
		if (type === 'input_json_delta' && typeof partialJson === 'string') {
			return this.emit({ type: 'block.delta', data: { blockId, inputJsonDelta: partialJson } });
		}
	}

	private handleAssistant(message: Extract<SDKMessage, { type: 'assistant' }>): void {
		const messageId = message.message.id;
		this.beginMessage(messageId, 'assistant');
		for (const block of (message.message.content ?? []) as unknown as RawBlock[]) {
			this.completeBlock(messageId, block, message);
		}
		const stopReason = message.message.stop_reason;
		if (stopReason) this.finishMessage(messageId, stopReason);
	}

	private handleUser(message: Extract<SDKMessage, { type: 'user' }>): void {
		const blocks = normalizeContent(message.message.content);
		if (this.consumeEcho(blocks)) return;
		const messageId = message.uuid ?? crypto.randomUUID();
		this.beginMessage(messageId, 'user');
		for (const block of blocks) this.completeBlock(messageId, block, message);
		this.finishMessage(messageId, null);
	}

	private handleResult(message: Extract<SDKMessage, { type: 'result' }>): void {
		for (const messageId of [...this.openMessages]) this.finishMessage(messageId, null);
		const usage = message.usage as unknown as Record<string, number> | undefined;
		this.totals.inputTokens += usage?.input_tokens ?? 0;
		this.totals.outputTokens += usage?.output_tokens ?? 0;
		this.totals.cacheReadTokens += usage?.cache_read_input_tokens ?? 0;
		this.totals.costUsd = message.total_cost_usd ?? this.totals.costUsd;
		this.emit({ type: 'usage.updated', data: { ...this.totals }, raw: message });

		const failed = message.subtype !== 'success' || message.is_error;
		this.emit({
			type: 'session.status',
			data: failed
				? { status: 'error', detail: 'result' in message ? String(message.result ?? message.subtype) : message.subtype }
				: { status: 'idle' },
			raw: message,
		});
	}

	private passthrough(message: SDKMessage): void {
		const subtype = 'subtype' in message ? `:${String(message.subtype)}` : '';
		this.emit({
			type: 'ext',
			data: { ns: 'claude-code', type: `${message.type}${subtype}`, data: message },
			raw: message,
		});
	}

	private beginMessage(messageId: string, role: MessageRole): void {
		this.currentMessageId = messageId;
		if (this.startedMessages.has(messageId)) return;
		this.startedMessages.add(messageId);
		this.openMessages.add(messageId);
		this.emit({ type: 'message.started', data: { messageId, role } });
	}

	private beginSyntheticMessage(): string {
		const messageId = crypto.randomUUID();
		this.beginMessage(messageId, 'assistant');
		return messageId;
	}

	private finishMessage(messageId: string, stopReason: string | null): void {
		if (!this.openMessages.delete(messageId)) return;
		this.pendingBlocks.delete(messageId);
		this.emit({ type: 'message.completed', data: { messageId, stopReason: stopReason ?? undefined } });
	}

	private trackBlock(messageId: string, block: StreamedBlock): void {
		const queue = this.pendingBlocks.get(messageId) ?? [];
		queue.push(block);
		this.pendingBlocks.set(messageId, queue);
	}

	private completeBlock(messageId: string, block: RawBlock, raw: unknown): void {
		const blockId = this.claimBlockId(messageId, block, raw);
		this.emit({ type: 'block.completed', data: { blockId, content: toBlockContent(block) }, raw });
	}

	/** Reuses the streamed block id when one matches, otherwise announces a new block. */
	private claimBlockId(messageId: string, block: RawBlock, raw: unknown): string {
		const kind = mapBlockKind(block.type);
		const toolUseId = typeof block.id === 'string' ? block.id : null;
		const queue = this.pendingBlocks.get(messageId) ?? [];
		const index = queue.findIndex(
			(candidate) => candidate.kind === kind && (!toolUseId || candidate.toolUseId === toolUseId),
		);
		if (index >= 0) return queue.splice(index, 1)[0]!.blockId;

		this.synthesizedBlocks += 1;
		const blockId = `${messageId}:s${this.synthesizedBlocks}`;
		this.emit({
			type: 'block.started',
			data: {
				messageId,
				blockId,
				kind,
				toolName: this.toolNameFor(block),
				toolUseId: toolUseId ?? (typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined),
			},
			raw,
		});
		return blockId;
	}

	private toolNameFor(block: RawBlock): string | undefined {
		if (typeof block.name === 'string') {
			if (typeof block.id === 'string') this.toolNamesByUseId.set(block.id, block.name);
			return block.name;
		}
		if (typeof block.tool_use_id === 'string') return this.toolNamesByUseId.get(block.tool_use_id);
		return undefined;
	}

	/**
	 * Drops the CLI's replay of a prompt we already emitted locally on `send()`.
	 * Attached images ride along as blocks of their own, so the match is on the one
	 * text block rather than on the message being a single block.
	 */
	private consumeEcho(blocks: RawBlock[]): boolean {
		const expected = this.expectedEchoes[0];
		if (expected === undefined) return false;
		if (blocks.some((block) => block.type !== 'text' && block.type !== 'image')) return false;
		const texts = blocks.filter((block) => block.type === 'text');
		if (texts.length !== 1 || texts[0]!.text !== expected.text) return false;
		this.expectedEchoes.shift();
		return true;
	}
}

function normalizeContent(content: unknown): RawBlock[] {
	if (typeof content === 'string') return [{ type: 'text', text: content }];
	if (Array.isArray(content)) return content as RawBlock[];
	return [];
}

function mapBlockKind(type: string): BlockKind {
	if (type === 'text') return 'text';
	if (type === 'thinking' || type === 'redacted_thinking') return 'thinking';
	if (type.endsWith('tool_use')) return 'tool_use';
	if (type.endsWith('tool_result')) return 'tool_result';
	if (type === 'image') return 'image';
	return type;
}

function toBlockContent(block: RawBlock): BlockContent {
	const kind = mapBlockKind(block.type);
	if (kind === 'text') return { kind: 'text', text: String(block.text ?? '') };
	if (kind === 'thinking') {
		return {
			kind: 'thinking',
			text: String(block.thinking ?? block.text ?? ''),
			signature: typeof block.signature === 'string' ? block.signature : undefined,
		};
	}
	if (kind === 'tool_use') {
		return {
			kind: 'tool_use',
			toolName: String(block.name ?? 'unknown'),
			toolUseId: String(block.id ?? ''),
			input: block.input,
		};
	}
	if (kind === 'tool_result') {
		return {
			kind: 'tool_result',
			toolUseId: String(block.tool_use_id ?? ''),
			output: block.content,
			isError: block.is_error === true,
		};
	}
	if (kind === 'image') {
		const source = (block.source ?? {}) as Record<string, unknown>;
		return {
			kind: 'image',
			mediaType: String(source.media_type ?? 'image/png'),
			data: typeof source.data === 'string' ? source.data : undefined,
			url: typeof source.url === 'string' ? source.url : undefined,
		};
	}
	return { ...block, kind };
}
