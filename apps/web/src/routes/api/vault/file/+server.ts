import { error, json, type RequestHandler } from "@sveltejs/kit";
import { vault } from "$lib/server/context";
import { parseByteRange } from "$lib/server/vault";
import { VaultWriteError } from "$lib/server/vault-write";

/**
 * A file out of the vault, streamed and range-aware. A clip is not something to
 * load: a media element asks for the part it is about to play, seeks by asking
 * for another part, and stalls against a server that can only answer with the
 * whole file — which is what this did, up to a cap that made a large video a 404.
 */
export const GET: RequestHandler = async ({ url, request }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const path = url.searchParams.get("path");
  if (!path) error(400, "path is required");

  const file = await vault().statFile(cwd, path);
  if (!file) error(404, "no such file in the vault");

  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Accept-Ranges": "bytes",
    // A vault file is the user's own, but this origin serves the app: nothing it
    // hands back is allowed to run, and no type may be guessed at from the bytes.
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    // Files change under the app and carry no hash, so a card that reloads has to
    // ask again rather than be told a stale copy is fresh.
    "Cache-Control": "no-cache",
  };

  const range = parseByteRange(request.headers.get("range"), file.size);
  if (!range) {
    return new Response(vault().fileStream(file), {
      headers: { ...headers, "Content-Length": String(file.size) },
    });
  }

  return new Response(vault().fileStream(file, range), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(range.end - range.start + 1),
      "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
    },
  });
};

/**
 * Bytes into the vault. The body is the file itself rather than a multipart form:
 * a drop is one file at a time, and the board already knows which topic it landed
 * in. The reply names where it actually went, which is not the requested name when
 * that one was taken.
 */
export const PUT: RequestHandler = async ({ url, request }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const name = url.searchParams.get("name");
  if (!name) error(400, "name is required");

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) error(400, "nothing to write");

  try {
    return json(await vault().write(cwd, url.searchParams.get("dir") ?? "", name, bytes));
  } catch (cause) {
    if (cause instanceof VaultWriteError) error(cause.status, cause.message);
    throw cause;
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const path = url.searchParams.get("path");
  if (!path) error(400, "path is required");

  try {
    await vault().delete(cwd, path);
    return json({ path });
  } catch (cause) {
    if (cause instanceof VaultWriteError) error(cause.status, cause.message);
    throw cause;
  }
};
