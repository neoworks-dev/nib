import { createSessionView, type BlockView, type MessageView, type SessionView } from '@nib-ui/protocol';

export function text(id: string, value: string): BlockView {
	return {
		id,
		messageId: '',
		kind: 'text',
		toolName: null,
		toolUseId: null,
		text: '',
		inputJson: '',
		content: { kind: 'text', text: value },
		completed: true,
	};
}

export function toolUse(id: string, toolName: string, input: unknown): BlockView {
	return {
		id,
		messageId: '',
		kind: 'tool_use',
		toolName,
		toolUseId: id,
		text: '',
		inputJson: '',
		content: { kind: 'tool_use', toolName, toolUseId: id, input },
		completed: true,
	};
}

export function toolResult(id: string, output: string): BlockView {
	return {
		id,
		messageId: '',
		kind: 'tool_result',
		toolName: null,
		toolUseId: id,
		text: output,
		inputJson: '',
		content: { kind: 'tool_result', toolUseId: id, output },
		completed: true,
	};
}

export function message(id: string, role: MessageView['role'], blocks: BlockView[]): MessageView {
	return { id, role, blocks, completed: true, stopReason: null };
}

export function session(
	sessionId: string,
	messages: MessageView[],
	overrides: Partial<SessionView> = {},
): SessionView {
	return { ...createSessionView(sessionId), messages, ...overrides };
}
