import { describe, expect, test } from 'bun:test';
import { createSessionView, type MessageView, type SessionView } from '@nib-ui/protocol';
import { composeHandoff, lastAssistantMessage, messageText, nextHandoff, peerRole, relayAllowed } from '../src/relay';

function message(id: string, role: 'user' | 'assistant', text: string, completed = true): MessageView {
	return {
		id,
		role,
		completed,
		stopReason: null,
		blocks: [
			{
				id: `${id}-b0`,
				messageId: id,
				kind: 'text',
				toolName: null,
				toolUseId: null,
				text,
				inputJson: '',
				content: { kind: 'text', text },
				completed: true,
			},
		],
	};
}

function view(messages: MessageView[], status: SessionView['status'] = 'idle'): SessionView {
	return { ...createSessionView('s1'), messages, status };
}

describe('relayAllowed', () => {
	test('off blocks both directions and two-way allows both', () => {
		expect(relayAllowed('off', 'critic')).toBe(false);
		expect(relayAllowed('off', 'builder')).toBe(false);
		expect(relayAllowed('both', 'builder')).toBe(true);
		expect(relayAllowed('both', 'critic')).toBe(true);
	});

	test('critic-to-builder is one-directional', () => {
		expect(relayAllowed('critic-to-builder', 'critic')).toBe(true);
		expect(relayAllowed('critic-to-builder', 'builder')).toBe(false);
	});

	test('peerRole pairs the two panes', () => {
		expect(peerRole('builder')).toBe('critic');
		expect(peerRole('critic')).toBe('builder');
	});
});

describe('lastAssistantMessage', () => {
	test('picks the newest completed assistant turn', () => {
		const chosen = lastAssistantMessage(
			view([message('m1', 'assistant', 'first'), message('m2', 'user', 'hi'), message('m3', 'assistant', 'second')]),
		);
		expect(chosen?.id).toBe('m3');
	});

	test('ignores a turn that is still streaming', () => {
		expect(lastAssistantMessage(view([message('m1', 'assistant', 'partial', false)]))).toBeNull();
		expect(lastAssistantMessage(null)).toBeNull();
	});
});

describe('nextHandoff', () => {
	const critic = view([message('m1', 'assistant', 'Three problems remain.')]);

	test('forwards a finished turn once', () => {
		const handoff = nextHandoff('critic-to-builder', { from: 'critic', view: critic, relayedMessageId: null });

		expect(handoff?.messageId).toBe('m1');
		expect(handoff?.text).toContain('Three problems remain.');
		expect(handoff?.text).toBe(composeHandoff('critic', 'Three problems remain.'));
		expect(nextHandoff('critic-to-builder', { from: 'critic', view: critic, relayedMessageId: 'm1' })).toBeNull();
	});

	test('waits for the pane to go idle', () => {
		const working = view([message('m1', 'assistant', 'partial')], 'working');
		expect(nextHandoff('both', { from: 'critic', view: working, relayedMessageId: null })).toBeNull();
	});

	test('stays silent when communication is off or the turn is empty', () => {
		expect(nextHandoff('off', { from: 'critic', view: critic, relayedMessageId: null })).toBeNull();
		expect(
			nextHandoff('both', { from: 'builder', view: view([message('m1', 'assistant', '  ')]), relayedMessageId: null }),
		).toBeNull();
	});

	test('marks the direction of the handoff text', () => {
		expect(composeHandoff('builder', 'done')).toContain('builder agent');
		expect(composeHandoff('critic', 'nope')).toContain('critic agent');
	});

	test('reads only text blocks out of a turn', () => {
		const mixed = message('m1', 'assistant', 'visible');
		mixed.blocks.push({
			id: 'm1-b1',
			messageId: 'm1',
			kind: 'tool_use',
			toolName: 'Bash',
			toolUseId: 't1',
			text: '',
			inputJson: '',
			content: { kind: 'tool_use', toolName: 'Bash', toolUseId: 't1', input: { command: 'ls' } },
			completed: true,
		});
		expect(messageText(mixed)).toBe('visible');
	});
});
