import { error, json, type RequestHandler } from "@sveltejs/kit";
import { vault } from "$lib/server/context";
import { VaultWriteError } from "$lib/server/vault-write";

interface MoveRequest {
  cwd?: unknown;
  from?: unknown;
  toDirectory?: unknown;
  rewrite?: unknown;
}

/**
 * The `mv` behind a drag onto a topic. The reply names every file whose links were
 * rewritten, which is what the undo of this move sends back as `rewrite` so the
 * reversal touches exactly the files the move did.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as MoveRequest;
  const cwd = readString(body.cwd);
  const from = readString(body.from);
  if (cwd === null) error(400, "cwd is required");
  if (from === null) error(400, "from is required");

  const toDirectory = readString(body.toDirectory) ?? "";
  const rewrite = Array.isArray(body.rewrite)
    ? body.rewrite.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  try {
    return json(await vault().move(cwd, from, toDirectory, { rewrite }));
  } catch (cause) {
    if (cause instanceof VaultWriteError) error(cause.status, cause.message);
    throw cause;
  }
};

function readString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}
