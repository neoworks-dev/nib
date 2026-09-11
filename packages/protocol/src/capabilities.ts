import { z } from "zod";
import { modelInfoSchema } from "./metadata";

export const harnessCapabilitiesSchema = z.object({
  interrupt: z.boolean(),
  permissionModes: z.array(z.string()),
  resume: z.boolean(),
  fork: z.boolean(),
  slashCommands: z.boolean(),
  models: z.boolean(),
  /** Reasoning-effort levels the harness accepts, coarsest first; absent means it has none. */
  effortLevels: z.array(z.string()).optional(),
  /** The harness snapshots files per turn, so a turn's edits can be rewound. */
  checkpoints: z.boolean().optional(),
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
