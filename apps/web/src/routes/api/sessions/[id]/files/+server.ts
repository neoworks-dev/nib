import { error, json, type RequestHandler } from "@sveltejs/kit";
import { workspace } from "$lib/server/context";
import { sessionCwd } from "$lib/server/session-cwd";

/** The cwd comes from the session, so a client can only search where its agent runs. */
export const GET: RequestHandler = async ({ params, url }) => {
  const cwd = sessionCwd(params.id!);
  if (!cwd) error(404, `unknown session "${params.id}"`);

  const limit = Number(url.searchParams.get("limit") ?? 20);
  const files = await workspace().searchFiles(cwd, url.searchParams.get("query") ?? "", limit);
  return json({ cwd, files });
};
