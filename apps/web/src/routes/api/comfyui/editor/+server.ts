import { error, json, type RequestHandler } from "@sveltejs/kit";
import { manifestSchema } from "@nib-ui/comfy";
import { z } from "zod";
import { comfyWorkflows } from "$lib/server/context";

const editorBodySchema = z.object({
  source: z.enum(["bundled", "user", "project", "draft"]),
  manifest: manifestSchema.nullable(),
  cwd: z.string().nullable(),
});

/** Asks every window's node editor to show a workflow; windows hear it on the events stream. */
export const POST: RequestHandler = async ({ request }) => {
  const body = editorBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) error(400, body.error.message);
  comfyWorkflows().openInEditor(body.data);
  return json({ ok: true });
};
