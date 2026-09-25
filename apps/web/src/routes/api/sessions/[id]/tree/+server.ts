import { error, json, type RequestHandler } from "@sveltejs/kit";
import { git } from "$lib/server/context";
import { sessionCwd } from "$lib/server/session-cwd";
import { listWorkspaceTree } from "$lib/server/workspace-tree";

/** Build output and dependencies are not what an agent's workspace is browsed for. */
const skipped = new Set(["node_modules", ".svelte-kit", "dist", "build", "target", ".nib-ui"]);

/** One directory level of the workspace, each entry tagged with its git status. */
export const GET: RequestHandler = async ({ params, url }) => {
  const cwd = sessionCwd(params.id!);
  if (!cwd) error(404, `unknown session "${params.id}"`);

  const listing = await listWorkspaceTree(cwd, url.searchParams.get("path") ?? "", {
    skip: skipped,
    changes: (await git().status(cwd)).files,
  });
  if (!listing) error(403, "path is outside the workspace");

  return json(listing);
};
