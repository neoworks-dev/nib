import { isAbsolute, resolve } from "node:path";
import { error, json, type RequestHandler } from "@sveltejs/kit";
import {
  AssetTooLargeError,
  MAX_ASSET_BYTES,
  UnsupportedAssetError,
} from "$lib/server/asset-store";
import { assets } from "$lib/server/context";
import { sessionCwd } from "$lib/server/session-cwd";

/**
 * Stores a file the session already wrote as an asset. The board only needs the
 * id, so the bytes — a model is megabytes of binary — never travel to the browser
 * and back just to be uploaded again.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const cwd = sessionCwd(params.id!);
  if (!cwd) error(404, `unknown session "${params.id}"`);

  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const requested = typeof body?.path === "string" ? body.path : "";
  if (requested.length === 0) error(400, "path is required");

  const absolute = isAbsolute(requested) ? resolve(requested) : resolve(cwd, requested);
  if (absolute !== cwd && !absolute.startsWith(`${cwd}/`))
    error(403, "path is outside the workspace");

  const file = Bun.file(absolute);
  if (!(await file.exists())) error(404, `no such file "${requested}"`);
  if (file.size > MAX_ASSET_BYTES) error(413, `file is larger than ${MAX_ASSET_BYTES} bytes`);

  const path = absolute.slice(cwd.length + 1);
  try {
    return json({
      ...(await assets().store(new Uint8Array(await file.arrayBuffer()), { allowText: true })),
      path,
    });
  } catch (cause) {
    if (cause instanceof AssetTooLargeError) error(413, cause.message);
    // The bytes decide the type, so a rejection means we cannot render it either.
    if (cause instanceof UnsupportedAssetError) error(415, cause.message);
    throw cause;
  }
};
