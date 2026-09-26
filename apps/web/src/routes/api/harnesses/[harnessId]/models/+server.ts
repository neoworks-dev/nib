import { error, json, type RequestHandler } from "@sveltejs/kit";
import { harnesses } from "$lib/server/context";
import { availableModels } from "$lib/server/harness-models";

/**
 * Apart from the harness list because asking a runtime can take seconds (the
 * Claude Code CLI has to start), and the list must not wait on it.
 */
export const GET: RequestHandler = async ({ params }) => {
  const harnessId = params.harnessId;
  if (harnessId === undefined) error(400, "harness id is required");
  const adapter = harnesses().get(harnessId);
  if (!adapter) error(404, `unknown harness "${harnessId}"`);
  return json({ models: await availableModels(adapter) });
};
