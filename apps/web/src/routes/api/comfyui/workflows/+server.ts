import { error, json, type RequestHandler } from "@sveltejs/kit";
import { manifestSchema } from "@nib-ui/comfy";
import { z } from "zod";
import { comfyWorkflows } from "$lib/server/context";
import { failComfy } from "../http";

const saveBodySchema = z.object({
  source: z.enum(["user", "project"]),
  cwd: z.string().min(1).optional(),
  manifest: manifestSchema,
});

/** The library; `?cwd=` adds that project's workflows. */
export const GET: RequestHandler = async ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  try {
    return json({ workflows: await comfyWorkflows().list(cwd) });
  } catch (cause) {
    failComfy(cause);
  }
};

/** Saves a workflow into the user's library or a project's. */
export const POST: RequestHandler = async ({ request }) => {
  const body = saveBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) error(400, body.error.message);
  try {
    return json(await comfyWorkflows().save(body.data));
  } catch (cause) {
    failComfy(cause);
  }
};
