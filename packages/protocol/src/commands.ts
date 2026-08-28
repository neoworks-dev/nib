import { z } from 'zod';
import { messageAttachmentSchema, permissionBehaviorSchema } from './events';

export const createSessionCommandSchema = z.object({
	type: z.literal('session.create'),
	harnessId: z.string(),
	cwd: z.string(),
	options: z.record(z.string(), z.unknown()).optional(),
});

export const sessionCommandSchema = z.discriminatedUnion('type', [
	createSessionCommandSchema,
	z.object({
		type: z.literal('session.send'),
		text: z.string(),
		attachments: z.array(messageAttachmentSchema).optional(),
	}),
	z.object({ type: z.literal('session.interrupt') }),
	z.object({
		type: z.literal('session.permission.respond'),
		requestId: z.string(),
		behavior: permissionBehaviorSchema,
		updatedInput: z.unknown().optional(),
	}),
	z.object({ type: z.literal('session.setPermissionMode'), mode: z.string() }),
	z.object({ type: z.literal('session.setModel'), model: z.string() }),
	z.object({ type: z.literal('session.setLabel'), label: z.string() }),
	z.object({ type: z.literal('session.setEffort'), effort: z.string() }),
	z.object({ type: z.literal('session.setArchived'), archived: z.boolean() }),
	/** Restores the working tree to the checkpoint the message carries; the transcript is untouched. */
	z.object({ type: z.literal('session.rewind'), messageId: z.string() }),
	/** Omit `nativeSessionId` to reattach to whatever the session's log last recorded. */
	z.object({ type: z.literal('session.resume'), nativeSessionId: z.string().optional(), fork: z.boolean().optional() }),
	z.object({ type: z.literal('session.close') }),
]);

export type SessionCommand = z.infer<typeof sessionCommandSchema>;
export type CreateSessionCommand = z.infer<typeof createSessionCommandSchema>;
export type CommandType = SessionCommand['type'];
