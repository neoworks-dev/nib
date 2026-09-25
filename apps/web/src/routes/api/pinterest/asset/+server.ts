import { error, json, type RequestHandler } from "@sveltejs/kit";
import { pinterest } from "$lib/server/context";
import { BlockedUrlError } from "$lib/server/link-preview";
import { failPinterest, requiredField } from "../http";

/**
 * Copies a pin's picture into the asset store. Server-side because the board
 * keeps an asset id rather than a link back to Pinterest's cdn, and because the
 * browser cannot read those bytes cross-origin anyway.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { imageUrl?: unknown } | null;
  const imageUrl = requiredField(body?.imageUrl);
  if (!imageUrl) error(400, "imageUrl is required");

  try {
    return json(await pinterest().storeImage(imageUrl));
  } catch (cause) {
    if (cause instanceof BlockedUrlError) error(400, cause.message);
    failPinterest(cause);
  }
};
