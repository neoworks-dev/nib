import { error } from "@sveltejs/kit";
import { ComfyApiError } from "$lib/server/comfyui";
import { ComfyWorkflowError } from "$lib/server/comfyui-library";

/**
 * ComfyUI's own status travels back: a 400 is a workflow it rejected, a 503 is a
 * server that is not running, and the composer tells the two apart.
 */
export function failComfy(cause: unknown): never {
  if (cause instanceof ComfyWorkflowError) error(cause.status, cause.message);
  if (cause instanceof ComfyApiError) {
    let status = 502;
    if (cause.status >= 400 && cause.status <= 599) status = cause.status;
    error(status, cause.message);
  }
  if (cause instanceof Error) error(502, cause.message);
  error(502, "ComfyUI request failed");
}
