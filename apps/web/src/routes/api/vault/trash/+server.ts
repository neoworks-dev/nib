import { error, json, type RequestHandler } from "@sveltejs/kit";
import { vault } from "$lib/server/context";
import { VaultWriteError } from "$lib/server/vault-write";

/**
 * The recycling bin. Deleting a card is a `POST` here rather than a `DELETE` of
 * the file: the entry is moved, not unlinked, so the gesture is reversible by the
 * board's own undo and by the bin after a reload.
 *
 * `PUT` is the reversal. It carries an entry id rather than a path, because two
 * deletions of the same path are two entries and only one of them is being
 * restored.
 */
export const GET: RequestHandler = async ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");
  return json(await vault().listTrash(cwd));
};

export const POST: RequestHandler = async ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const path = url.searchParams.get("path");
  if (!path) error(400, "path is required");

  try {
    return json(await vault().trash(cwd, path));
  } catch (cause) {
    if (cause instanceof VaultWriteError) error(cause.status, cause.message);
    throw cause;
  }
};

export const PUT: RequestHandler = async ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const id = url.searchParams.get("id");
  if (!id) error(400, "id is required");

  try {
    return json(await vault().restoreTrash(cwd, id));
  } catch (cause) {
    if (cause instanceof VaultWriteError) error(cause.status, cause.message);
    throw cause;
  }
};

/** With an id, one entry for good; without one, the whole bin. */
export const DELETE: RequestHandler = async ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const id = url.searchParams.get("id");
  try {
    await vault().purgeTrash(cwd, id ?? undefined);
    return json({ purged: id });
  } catch (cause) {
    if (cause instanceof VaultWriteError) error(cause.status, cause.message);
    throw cause;
  }
};
