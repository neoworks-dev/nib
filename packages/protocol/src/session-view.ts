import type { HarnessCapabilities } from './capabilities';
import type {
	AnyAgentEvent,
	BlockContent,
	BlockKind,
	MessageRole,
	PermissionBehavior,
	SessionStatus,
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
	lastSeq: number;
}

export interface OrphanBlock {
	text: string;
	inputJson: string;
	content: BlockContent | null;
	completed: boolean;
}

export function createSessionView(sessionId: string): SessionView {
	return {
		sessionId,
		harnessId: null,
		cwd: null,
		title: null,
		nativeSessionId: null,
		capabilities: null,
		status: 'idle',
		statusDetail: null,
		messages: [],
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
		pendingPermissions: [],
		resolvedPermissions: [],
		logs: [],
		unhandled: [],
		orphanBlocks: {},
		lastSeq: 0,
	};
}
