import { error, json, type RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { comfyWorkflows } from "$lib/server/context";
import { failComfy } from "../../http";

const runBodySchema = z.object({
  cwd: z.string().min(1),
  source: z.enum(["bundled", "user", "project"]),
  workflowId: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
  outputDirectory: z.string().optional(),
  at: z.object({ x: z.number(), y: z.number() }).optional(),
});

/** Fills a library workflow's parameters and queues it. */
export const POST: RequestHandler = async ({ request }) => {
  const body = runBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) error(400, body.error.message);
  try {
    return json(await comfyWorkflows().run(body.data));
  } catch (cause) {
    failComfy(cause);
  }
};
