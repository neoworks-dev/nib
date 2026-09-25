import { json, type RequestHandler } from "@sveltejs/kit";
import { comfyui } from "$lib/server/context";
import { failComfy } from "../../http";

/** Cancels a run: dropped from the queue if it has not started, interrupted if it has. */
export const DELETE: RequestHandler = async ({ params }) => {
  try {
    await comfyui().cancel(String(params.id));
    return json({ ok: true });
  } catch (cause) {
    failComfy(cause);
  }
};
