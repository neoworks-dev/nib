import { z } from 'zod';
import { modelInfoSchema } from './metadata';

export const harnessCapabilitiesSchema = z.object({
	interrupt: z.boolean(),
	permissionModes: z.array(z.string()),
	resume: z.boolean(),
	fork: z.boolean(),
	slashCommands: z.boolean(),
	models: z.boolean(),
});

export type HarnessCapabilities = z.infer<typeof harnessCapabilitiesSchema>;

export const harnessDescriptorSchema = z.object({
	id: z.string(),
	displayName: z.string(),
	capabilities: harnessCapabilitiesSchema,
	/** Composer pre-flight: what a fresh session starts with, before the harness answers. */
	defaultPermissionMode: z.string(),
	models: z.array(modelInfoSchema),
	defaultModel: z.string().optional(),
});

export type HarnessDescriptor = z.infer<typeof harnessDescriptorSchema>;
