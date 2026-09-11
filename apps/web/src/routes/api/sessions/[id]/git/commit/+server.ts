import { error, json, type RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { git } from "$lib/server/context";
import { sessionCwd } from "$lib/server/session-cwd";

const bodySchema = z.object({ message: z.string().min(1), paths: z.array(z.string()).optional() });

export const POST: RequestHandler = async ({ params, request }) => {
  const cwd = sessionCwd(params.id!);
  if (!cwd) error(404, `unknown session "${params.id}"`);
  const body = bodySchema.safeParse(await request.json());
  if (!body.success) error(400, body.error.message);

  const result = await git().commit(cwd, body.data.message, body.data.paths ?? []);
  if (!result.ok) error(400, result.output || "git commit failed");
  return json({ output: result.output });
};
