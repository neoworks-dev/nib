import { error, json, type RequestHandler } from "@sveltejs/kit";
import {
  AssetTooLargeError,
  MAX_ASSET_BYTES,
  UnsupportedAssetError,
} from "$lib/server/asset-store";
import { assets, vault } from "$lib/server/context";

/**
 * Copies a vault file into the asset store and answers with its id. A picture on
 * the board that a task is started from travels with the prompt as an attachment,
 * and an attachment is addressed by asset id: the bytes stay on the server and
 * never cross the browser to be uploaded again.
 */
export const POST: RequestHandler = async ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const path = url.searchParams.get("path");
  if (!path) error(400, "path is required");

  const file = await vault().readFile(cwd, path, { maxBytes: MAX_ASSET_BYTES });
  if (!file) error(404, "no such file in the vault, or it is too large to attach");

  try {
    return json({
      ...(await assets().store(new Uint8Array(file.bytes), { allowText: true })),
      path,
    });
  } catch (cause) {
    if (cause instanceof AssetTooLargeError) error(413, cause.message);
    if (cause instanceof UnsupportedAssetError) error(415, cause.message);
    throw cause;
  }
};
