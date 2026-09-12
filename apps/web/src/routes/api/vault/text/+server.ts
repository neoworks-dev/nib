import { error, json, type RequestHandler } from "@sveltejs/kit";
import { vault } from "$lib/server/context";
import { VaultWriteError } from "$lib/server/vault-write";

/**
 * A note's body back. Separate from `/api/vault/file`, which takes bytes into a
 * directory under a name that is free: this one addresses an existing path and
 * keeps it, because a save is not a move and a rename would break every
 * `[[link]]` pointing at the note.
 *
 * The body is the text itself rather than JSON. A note is a document, and
 * wrapping it in an envelope only to unwrap it costs a copy of the whole thing.
 */
export const PUT: RequestHandler = async ({ url, request }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const path = url.searchParams.get("path");
  if (!path) error(400, "path is required");

  // An empty body is a real edit: clearing a note is not the same as not saving.
  const text = await request.text();

  try {
    await vault().writeText(cwd, path, text);
    return json({ path });
  } catch (cause) {
    if (cause instanceof VaultWriteError) error(cause.status, cause.message);
    throw cause;
  }
};
