import { z } from 'zod';

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
});

export type HarnessDescriptor = z.infer<typeof harnessDescriptorSchema>;
