import type { HarnessCapabilities } from './capabilities';
import type {
	AnyAgentEvent,
	BlockContent,
	BlockKind,
	MessageAttachment,
	MessageRole,
	ModelInfo,
	PermissionBehavior,
	SessionStatus,
	SlashCommandInfo,
} from './events';

export interface BlockView {
	id: string;
	messageId: string;
	kind: BlockKind;
	toolName: string | null;
	toolUseId: string | null;
	/** Accumulated `textDelta`s; superseded by `content` once the block completes. */
	text: string;
	/** Accumulated `inputJsonDelta`s for tool_use blocks — may be incomplete JSON while streaming. */
	inputJson: string;
	content: BlockContent | null;
	completed: boolean;
}

export interface MessageView {
	id: string;
	role: MessageRole;
	blocks: BlockView[];
	completed: boolean;
	stopReason: string | null;
	/**
	 * Files sent with the prompt; the reducer always fills it, empty for anything
	 * the harness produced. Optional so a consumer that builds a message by hand
	 * does not have to name it.
	 */
	attachments?: MessageAttachment[];
}

export interface UsageView {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	costUsd: number;
}

export interface PermissionRequestView {
	requestId: string;
	toolName: string;
	input: unknown;
	suggestions: unknown[];
}

export interface LogEntryView {
	level: 'debug' | 'info' | 'warn' | 'error';
	message: string;
	ts: number;
}

export interface PermissionResolutionView {
	requestId: string;
	behavior: PermissionBehavior;
	resolvedBy: 'user' | 'policy';
}

export interface SessionView {
	sessionId: string;
	harnessId: string | null;
	cwd: string | null;
	title: string | null;
	nativeSessionId: string | null;
	capabilities: HarnessCapabilities | null;
	/** Active permission mode, as last reported by the harness. */
	permissionMode: string | null;
	/** Active reasoning-effort level, when the harness has any. */
	effort: string | null;
	/** Archived tasks stay listable and resumable; the sidebar just stops showing them. */
	archived: boolean;
	model: string | null;
	slashCommands: SlashCommandInfo[];
	models: ModelInfo[];
	status: SessionStatus;
	statusDetail: string | null;
	messages: MessageView[];
	usage: UsageView;
	pendingPermissions: PermissionRequestView[];
	resolvedPermissions: PermissionResolutionView[];
	logs: LogEntryView[];
	/** `ext` events and event types this build does not know — preserved, never fatal. */
	unhandled: AnyAgentEvent[];
	/** Deltas that arrived before their `block.started`; merged in when the block appears. */
	orphanBlocks: Record<string, OrphanBlock>;
	/** Message id → the harness's restore point for the working tree as it was before it. */
	checkpoints: Record<string, string>;
	lastSeq: number;
}

export interface OrphanBlock {
	text: string;
	inputJson: string;
	content: BlockContent | null;
	completed: boolean;
}

/** Completed input when the block finished, otherwise the partial JSON parsed best-effort. */
export function blockToolInput(block: BlockView): unknown {
	if (block.content?.kind === 'tool_use') return (block.content as { input?: unknown }).input;
	if (block.inputJson.length === 0) return undefined;
	try {
		return JSON.parse(block.inputJson);
	} catch {
		return block.inputJson;
	}
}

export function blockToolOutput(block: BlockView): unknown {
	if (block.content?.kind === 'tool_result') return (block.content as { output?: unknown }).output;
	return block.text.length > 0 ? block.text : undefined;
}

/** The result block a tool call produced, once the harness reports it. */
export function findToolResultBlock(session: SessionView, toolUseId: string | null): BlockView | null {
	return findBlockByToolUseId(session, 'tool_result', toolUseId);
}

/** Lets a result renderer detect that its call is already on screen and stay quiet. */
export function findToolUseBlock(session: SessionView, toolUseId: string | null): BlockView | null {
	return findBlockByToolUseId(session, 'tool_use', toolUseId);
}

function findBlockByToolUseId(session: SessionView, kind: BlockKind, toolUseId: string | null): BlockView | null {
	if (!toolUseId) return null;
	for (const message of session.messages) {
		for (const block of message.blocks) {
			if (block.kind === kind && block.toolUseId === toolUseId) return block;
		}
	}
	return null;
}

/**
 * A pending permission describes a tool call that has not entered the message
 * log yet; shaping it as a block lets the same renderers preview it.
 */
export function permissionPreviewBlock(request: PermissionRequestView): BlockView {
	return {
		id: `permission:${request.requestId}`,
		messageId: `permission:${request.requestId}`,
		kind: 'tool_use',
		toolName: request.toolName,
		toolUseId: null,
		text: '',
		inputJson: '',
		content: { kind: 'tool_use', toolName: request.toolName, toolUseId: '', input: request.input },
		completed: true,
	};
}

export function createSessionView(sessionId: string): SessionView {
	return {
		sessionId,
		harnessId: null,
		cwd: null,
		title: null,
		nativeSessionId: null,
		capabilities: null,
		permissionMode: null,
		effort: null,
		archived: false,
		model: null,
		slashCommands: [],
		models: [],
		status: 'idle',
		statusDetail: null,
		messages: [],
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
		pendingPermissions: [],
		resolvedPermissions: [],
		logs: [],
		unhandled: [],
		orphanBlocks: {},
		checkpoints: {},
		lastSeq: 0,
	};
}

/**
 * The restore point that undoes a turn. An assistant message's edits belong to
 * the user message that asked for them, so the search walks back from the given
 * message to the nearest checkpointed one.
 */
export function checkpointBefore(session: SessionView, messageId: string): string | null {
	const index = session.messages.findIndex((message) => message.id === messageId);
	if (index < 0) return null;
	for (let cursor = index; cursor >= 0; cursor -= 1) {
		const checkpoint = session.checkpoints[session.messages[cursor]!.id];
		if (checkpoint) return checkpoint;
	}
	return null;
}
