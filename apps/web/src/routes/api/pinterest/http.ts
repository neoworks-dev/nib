import { error } from "@sveltejs/kit";
import { PinterestApiError } from "$lib/server/pinterest";

/**
 * Pinterest's own status travels back to the pane: a 401 means the connection
 * needs renewing and a 429 means waiting, and both read as a server fault if
 * they are flattened into one.
 */
export function failPinterest(cause: unknown): never {
  if (cause instanceof PinterestApiError) {
    const status = cause.status >= 400 && cause.status <= 599 ? cause.status : 502;
    error(status, cause.message);
  }
  error(502, cause instanceof Error ? cause.message : "pinterest request failed");
}

/** A field of a json body that has to be there and has to say something. */
export function requiredField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}
