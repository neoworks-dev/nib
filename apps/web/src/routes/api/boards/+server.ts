import type { BoardWrite } from "@nib-ui/ui-contracts";
import { error, json, type RequestHandler } from "@sveltejs/kit";
import { StaleBoardWriteError } from "$lib/server/board-store";
import { boards } from "$lib/server/context";

function requireCwd(url: URL): string {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");
  return cwd;
}

export const GET: RequestHandler = async ({ url }) => json(await boards().read(requireCwd(url)));

export const PUT: RequestHandler = async ({ url, request }) => {
  const cwd = requireCwd(url);
  const board = (await request.json()) as BoardWrite;
  if (board?.cwd !== cwd) error(400, "board cwd does not match the query");

  try {
    return json(await boards().write(board));
  } catch (cause) {
    // The client has to reload and re-apply: its board is behind another window's.
    if (cause instanceof StaleBoardWriteError)
      error(409, `stale board revision, current is ${cause.current}`);
    throw cause;
  }
};
