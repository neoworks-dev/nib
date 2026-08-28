import type { BlockView, MessageView, SessionView } from '@nib-ui/protocol';
import { summarizeChanges, type ChangedFile } from '@nib-ui/plugin-renderer-diff/changed-files';
import { describeCall } from '@nib-ui/ui-contracts';
import type { Exchange } from './model';

export function exchangeId(sessionId: string, messageId: string): string {
	return `${sessionId}#${messageId}`;
}

/**
 * Folds a transcript into the unit the canvas draws: a prompt plus the turns that
 * answered it. A user message carrying only tool results is bookkeeping inside the
 * current exchange, not the start of a new one.
 */
export function toExchanges(session: SessionView): Exchange[] {
	const exchanges: Exchange[] = [];

	for (const message of session.messages) {
		if (message.role === 'user' && message.blocks.some((block) => block.kind === 'text')) {
			exchanges.push({
				id: exchangeId(session.sessionId, message.id),
				sessionId: session.sessionId,
				messageId: message.id,
				prompt: messageText(message),
				reply: '',
				steps: [],
				changes: [],
				working: false,
				messageIds: [message.id],
			});
			continue;
		}

		if (message.role !== 'assistant') continue;

		// A transcript that opens with harness output (a resumed session, a slash
		// command) still needs somewhere to put it.
		if (exchanges.length === 0) {
			exchanges.push({
				id: exchangeId(session.sessionId, message.id),
				sessionId: session.sessionId,
				messageId: message.id,
				prompt: '',
				reply: '',
				steps: [],
				changes: [],
				working: false,
				messageIds: [],
			});
		}
		const current = exchanges[exchanges.length - 1]!;
		current.messageIds.push(message.id);

		const reply = messageText(message);
		if (reply.length > 0) current.reply = current.reply.length > 0 ? `${current.reply}\n\n${reply}` : reply;

		for (const block of message.blocks) {
			if (block.kind !== 'tool_use') continue;
			const call = describeCall(block);
			if (call.label !== 'Edit') current.steps.push({ ...call, messageId: message.id, blockId: block.id });
		}
		mergeChanges(current.changes, summarizeChanges(message).files);
	}

	const last = exchanges.at(-1);
	if (last && (session.status === 'working' || session.status === 'awaiting-permission')) last.working = true;
	return exchanges;
}

export function messageText(message: MessageView): string {
	return message.blocks
		.filter((block) => block.kind === 'text')
		.map(blockText)
		.join('\n')
		.trim();
}

export function blockText(block: BlockView): string {
	if (block.content?.kind === 'text') return (block.content as { text: string }).text;
	return block.text;
}

function mergeChanges(target: ChangedFile[], incoming: ChangedFile[]): void {
	for (const file of incoming) {
		const existing = target.find((entry) => entry.path === file.path);
		if (!existing) {
			target.push({ ...file });
			continue;
		}
		existing.added += file.added;
		existing.removed += file.removed;
	}
}
