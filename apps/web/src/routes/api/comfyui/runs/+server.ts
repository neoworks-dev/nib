import { error, json, type RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { comfyui } from "$lib/server/context";
import { failComfy } from "../http";

const queueBodySchema = z.object({
  cwd: z.string().min(1),
  workflow: z.record(
    z.string(),
    z.object({
      class_type: z.string(),
      inputs: z.record(z.string(), z.unknown()),
      _meta: z.object({ title: z.string().optional() }).optional(),
    }),
  ),
  uploads: z
    .array(z.object({ nodeId: z.string(), input: z.string(), path: z.string() }))
    .optional(),
  outputDirectory: z.string().optional(),
});

export const GET: RequestHandler = () => json({ runs: comfyui().runs() });

export const POST: RequestHandler = async ({ request }) => {
  const body = queueBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) error(400, body.error.message);
  try {
    return json(await comfyui().queue(body.data));
  } catch (cause) {
    failComfy(cause);
  }
};
