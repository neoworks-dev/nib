import type { VaultOpenOptions } from "$lib/server/vault";
import { error, json, type RequestHandler } from "@sveltejs/kit";
import { vault } from "$lib/server/context";

export const GET: RequestHandler = async ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const options: VaultOpenOptions = {
    mentions: url.searchParams.get("mentions") === "1",
    previewChars: readPreviewChars(url),
  };

  return json(await vault().open(cwd, options));
};

/** An unusable length is ignored rather than clamped: a caller asking for nonsense
 *  gets the default preview, not an empty one. */
function readPreviewChars(url: URL): number | undefined {
  const raw = url.searchParams.get("previewChars");
  if (raw === null) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}
