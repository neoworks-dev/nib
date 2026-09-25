import { json, type RequestHandler } from "@sveltejs/kit";
import { comfyui } from "$lib/server/context";
import { failComfy } from "../http";

/** `/object_info`, cached server-side; `?refresh=1` fetches it again. */
export const GET: RequestHandler = async ({ url }) => {
  try {
    return json(await comfyui().nodeDefinitions(url.searchParams.get("refresh") === "1"));
  } catch (cause) {
    failComfy(cause);
  }
};
