import { z } from "zod";

export const slashCommandSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  argumentHint: z.string().optional(),
});
export type SlashCommandInfo = z.infer<typeof slashCommandSchema>;

export const modelInfoSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
});
export type ModelInfo = z.infer<typeof modelInfoSchema>;
