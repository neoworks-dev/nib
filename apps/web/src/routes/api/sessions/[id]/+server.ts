import { error, json, type RequestHandler } from "@sveltejs/kit";
import { sessionHost } from "$lib/server/context";

export const DELETE: RequestHandler = async ({ params }) => {
  const sessionId = params.id!;
  const host = sessionHost();
  if (!host.has(sessionId)) error(404, `unknown session "${sessionId}"`);
  await host.remove(sessionId);
  return json({ removed: sessionId });
};
