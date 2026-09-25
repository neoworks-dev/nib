import { error, json, type RequestHandler } from "@sveltejs/kit";
import { vault } from "$lib/server/context";
import { VaultWriteError } from "$lib/server/vault-write";

interface RenameRequest {
  cwd?: unknown;
  from?: unknown;
  name?: unknown;
  rewrite?: unknown;
}

/**
 * Renaming an entry where it is: the folder name edited on its card. The reply
 * names every file whose links were rewritten, which the undo sends back as
 * `rewrite` so the reversal touches exactly those files.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as RenameRequest;
  const cwd = readString(body.cwd);
  const from = readString(body.from);
  const name = readString(body.name);
  if (cwd === null) error(400, "cwd is required");
  if (from === null) error(400, "from is required");
  if (name === null) error(400, "name is required");

  let rewrite: string[] | undefined = undefined;
  if (Array.isArray(body.rewrite)) {
    rewrite = body.rewrite.filter((entry): entry is string => typeof entry === "string");
  }

  try {
    return json(await vault().rename(cwd, from, name, { rewrite }));
  } catch (cause) {
    if (cause instanceof VaultWriteError) error(cause.status, cause.message);
    throw cause;
  }
};

/** A non-empty string, or null for anything else. */
function readString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}
