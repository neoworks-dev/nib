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

export function toolResult(id: string): BlockView {
	return {
		id,
		messageId: '',
		kind: 'tool_result',
		toolName: null,
		toolUseId: id,
		text: 'ok',
		inputJson: '',
		content: { kind: 'tool_result', toolUseId: id, output: 'ok' },
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

/** A chain of `prompt → reply` turns, which is what most graph cases need. */
export function chat(sessionId: string, prompts: string[], overrides: Partial<SessionView> = {}): SessionView {
	const messages = prompts.flatMap((prompt, index) => [
		message(`u${index}`, 'user', [text(`ub${index}`, prompt)]),
		message(`a${index}`, 'assistant', [text(`ab${index}`, `answer to ${prompt}`)]),
	]);
	return session(sessionId, messages, overrides);
}
