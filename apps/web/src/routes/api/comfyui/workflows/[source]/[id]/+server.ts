import { error, json, type RequestHandler } from "@sveltejs/kit";
import { comfyWorkflows } from "$lib/server/context";
import { failComfy } from "../../../http";

/** Removes a user workflow, or bins a project one (`?cwd=` names the project). */
export const DELETE: RequestHandler = async ({ params, url }) => {
  const { source, id } = params;
  if ((source !== "user" && source !== "project") || !id)
    error(400, "only user and project workflows can be deleted");
  try {
    await comfyWorkflows().delete(source, id, url.searchParams.get("cwd"));
    return json({ ok: true });
  } catch (cause) {
    failComfy(cause);
  }
};
