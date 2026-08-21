import { isKnownEvent, type AnyAgentEvent, type BlockContent, type EventDataMap, type MessageRole } from './events';
import type { BlockView, MessageView, OrphanBlock, SessionView } from './session-view';

const emptyOrphan: OrphanBlock = { text: '', inputJson: '', content: null, completed: false };

/**
 * Pure projection of the append-only log. Events at or below `lastSeq` are
 * ignored so a reconnect that replays overlapping history is a no-op, and
 * anything this build cannot interpret lands in `unhandled` instead of throwing.
 */
export function reduceSession(state: SessionView, event: AnyAgentEvent): SessionView {
	if (event.seq <= state.lastSeq) return state;
	return { ...applyEvent(state, event), lastSeq: event.seq };
}

export function reduceSessionAll(state: SessionView, events: AnyAgentEvent[]): SessionView {
	return events.reduce(reduceSession, state);
}

function applyEvent(state: SessionView, event: AnyAgentEvent): SessionView {
	if (!isKnownEvent(event)) return { ...state, unhandled: [...state.unhandled, event] };
	switch (event.type) {
		case 'session.created':
			return applySessionCreated(state, event.data);
		case 'session.meta':
			return applySessionMeta(state, event.data);
		case 'session.cleared':
			// Usage and metadata survive: only the conversation went away.
			return { ...state, messages: [], orphanBlocks: {}, pendingPermissions: [], resolvedPermissions: [] };
		case 'session.status':
			return { ...state, status: event.data.status, statusDetail: event.data.detail ?? null };
		case 'message.started':
			return ensureMessage(state, event.data.messageId, event.data.role);
		case 'message.completed':
			return mapMessage(state, event.data.messageId, (message) => ({
				...message,
				completed: true,
				stopReason: event.data.stopReason ?? null,
			}));
		case 'block.started':
			return applyBlockStarted(state, event.data);
		case 'block.delta':
			return applyBlockDelta(state, event.data);
		case 'block.completed':
			return applyBlockCompleted(state, event.data);
		case 'permission.requested':
			return applyPermissionRequested(state, event.data);
		case 'permission.resolved':
			return applyPermissionResolved(state, event.data);
		case 'usage.updated':
			return applyUsage(state, event.data);
		case 'log':
			return { ...state, logs: [...state.logs, { ...event.data, ts: event.ts }] };
		case 'ext':
			return { ...state, unhandled: [...state.unhandled, event] };
	}
}

function applySessionCreated(state: SessionView, data: EventDataMap['session.created']): SessionView {
	return {
		...state,
		harnessId: data.harnessId,
		cwd: data.cwd,
		title: data.title ?? state.title,
		nativeSessionId: data.nativeSessionId ?? state.nativeSessionId,
		capabilities: data.capabilities,
	};
}

/** Every field is optional: a partial update must not clear what it omits. */
function applySessionMeta(state: SessionView, data: EventDataMap['session.meta']): SessionView {
	return {
		...state,
		title: data.label ?? state.title,
		model: data.model ?? state.model,
		permissionMode: data.permissionMode ?? state.permissionMode,
		slashCommands: data.slashCommands ?? state.slashCommands,
		models: data.models ?? state.models,
	};
}

function applyBlockStarted(state: SessionView, data: EventDataMap['block.started']): SessionView {
	const withMessage = ensureMessage(state, data.messageId, 'assistant');
	const buffered = withMessage.orphanBlocks[data.blockId] ?? emptyOrphan;
	const block: BlockView = {
		id: data.blockId,
		messageId: data.messageId,
		kind: data.kind,
		toolName: data.toolName ?? null,
		toolUseId: data.toolUseId ?? null,
		text: buffered.content ? contentText(buffered.content) ?? buffered.text : buffered.text,
		inputJson: buffered.inputJson,
		content: buffered.content,
		completed: buffered.completed,
	};
	return appendBlock(dropOrphan(withMessage, data.blockId), block);
}

function applyBlockDelta(state: SessionView, data: EventDataMap['block.delta']): SessionView {
	const patched = mapBlock(state, data.blockId, (block) =>
		block.completed
			? block
			: {
					...block,
					text: block.text + (data.textDelta ?? ''),
					inputJson: block.inputJson + (data.inputJsonDelta ?? ''),
				},
	);
	if (patched) return patched;
	return bufferOrphan(state, data.blockId, (orphan) => ({
		...orphan,
		text: orphan.text + (data.textDelta ?? ''),
		inputJson: orphan.inputJson + (data.inputJsonDelta ?? ''),
	}));
}

function applyBlockCompleted(state: SessionView, data: EventDataMap['block.completed']): SessionView {
	const patched = mapBlock(state, data.blockId, (block) => ({
		...block,
		content: data.content,
		completed: true,
		text: contentText(data.content) ?? block.text,
	}));
	if (patched) return patched;
	return bufferOrphan(state, data.blockId, (orphan) => ({ ...orphan, content: data.content, completed: true }));
}

function applyPermissionRequested(state: SessionView, data: EventDataMap['permission.requested']): SessionView {
	if (state.pendingPermissions.some((request) => request.requestId === data.requestId)) return state;
	const request = {
		requestId: data.requestId,
		toolName: data.toolName,
		input: data.input,
		suggestions: data.suggestions ?? [],
	};
	return { ...state, pendingPermissions: [...state.pendingPermissions, request] };
}

function applyPermissionResolved(state: SessionView, data: EventDataMap['permission.resolved']): SessionView {
	return {
		...state,
		pendingPermissions: state.pendingPermissions.filter((request) => request.requestId !== data.requestId),
		resolvedPermissions: [
			...state.resolvedPermissions,
			{ requestId: data.requestId, behavior: data.behavior, resolvedBy: data.resolvedBy },
		],
	};
}

function applyUsage(state: SessionView, data: EventDataMap['usage.updated']): SessionView {
	return {
		...state,
		usage: {
			inputTokens: data.inputTokens,
			outputTokens: data.outputTokens,
			cacheReadTokens: data.cacheReadTokens ?? state.usage.cacheReadTokens,
			costUsd: data.costUsd ?? state.usage.costUsd,
		},
	};
}

function ensureMessage(state: SessionView, messageId: string, role: MessageRole): SessionView {
	if (state.messages.some((message) => message.id === messageId)) return state;
	const message: MessageView = { id: messageId, role, blocks: [], completed: false, stopReason: null };
	return { ...state, messages: [...state.messages, message] };
}

function mapMessage(state: SessionView, messageId: string, patch: (message: MessageView) => MessageView): SessionView {
	const index = state.messages.findIndex((message) => message.id === messageId);
	if (index < 0) return state;
	const messages = [...state.messages];
	messages[index] = patch(messages[index]!);
	return { ...state, messages };
}

function appendBlock(state: SessionView, block: BlockView): SessionView {
	return mapMessage(state, block.messageId, (message) => ({ ...message, blocks: [...message.blocks, block] }));
}

/** Returns null when the block has not been announced yet, so the caller can buffer. */
function mapBlock(state: SessionView, blockId: string, patch: (block: BlockView) => BlockView): SessionView | null {
	for (let index = state.messages.length - 1; index >= 0; index -= 1) {
		const message = state.messages[index]!;
		const blockIndex = message.blocks.findIndex((block) => block.id === blockId);
		if (blockIndex < 0) continue;
		const blocks = [...message.blocks];
		blocks[blockIndex] = patch(blocks[blockIndex]!);
		const messages = [...state.messages];
		messages[index] = { ...message, blocks };
		return { ...state, messages };
	}
	return null;
}

function bufferOrphan(state: SessionView, blockId: string, patch: (orphan: OrphanBlock) => OrphanBlock): SessionView {
	const orphan = patch(state.orphanBlocks[blockId] ?? emptyOrphan);
	return { ...state, orphanBlocks: { ...state.orphanBlocks, [blockId]: orphan } };
}

function dropOrphan(state: SessionView, blockId: string): SessionView {
	if (!(blockId in state.orphanBlocks)) return state;
	const { [blockId]: _removed, ...rest } = state.orphanBlocks;
	return { ...state, orphanBlocks: rest };
}

function contentText(content: BlockContent): string | null {
	if (content.kind !== 'text' && content.kind !== 'thinking') return null;
	const { text } = content as { text?: unknown };
	return typeof text === 'string' ? text : null;
}
