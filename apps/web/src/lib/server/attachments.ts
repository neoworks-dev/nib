import type { MessageAttachment } from '@nib-ui/protocol';
import type { SessionAttachment } from './services';

/**
 * The baseline every harness understands. Attached bytes live in the asset store,
 * not in the workspace, so the prompt names them by absolute path: a harness with
 * no multimodal input can still open the file with the tools it already has.
 */
export function composeAttachmentPrompt(text: string, attachments: readonly SessionAttachment[]): string {
	if (attachments.length === 0) return text;
	const lines = attachments.map((attachment) => `- ${attachment.name} (${attachment.mime}): ${attachment.path}`);
	const block = `Attached files, readable at these paths:\n${lines.join('\n')}`;
	return text.trim().length === 0 ? block : `${text}\n\n${block}`;
}

/**
 * What the transcript records: the store id, not the path. `undefined` for a
 * prompt with no attachments, so the event stays byte-identical to today's.
 */
export function attachmentMetadata(attachments: readonly SessionAttachment[]): MessageAttachment[] | undefined {
	if (attachments.length === 0) return undefined;
	return attachments.map(({ assetId, mime, name }) => ({ assetId, mime, name }));
}
