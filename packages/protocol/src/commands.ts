import { z } from 'zod';
import { permissionBehaviorSchema } from './events';

export const createSessionCommandSchema = z.object({
	type: z.literal('session.create'),
	harnessId: z.string(),
	cwd: z.string(),
	options: z.record(z.string(), z.unknown()).optional(),
});

export const sessionCommandSchema = z.discriminatedUnion('type', [
	createSessionCommandSchema,
	z.object({ type: z.literal('session.send'), text: z.string() }),
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
	z.object({ type: z.literal('session.resume'), nativeSessionId: z.string(), fork: z.boolean().optional() }),
	z.object({ type: z.literal('session.close') }),
]);

export type SessionCommand = z.infer<typeof sessionCommandSchema>;
export type CreateSessionCommand = z.infer<typeof createSessionCommandSchema>;
export type CommandType = SessionCommand['type'];
