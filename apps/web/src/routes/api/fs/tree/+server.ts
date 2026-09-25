import { error, json, type RequestHandler } from "@sveltejs/kit";
import { git } from "$lib/server/context";
import { listWorkspaceTree } from "$lib/server/workspace-tree";

/**
 * One directory level of a project, addressed by the directory itself rather than
 * through a session: a project is browsable whether or not a conversation about it
 * is open. Nothing but `.git` is filtered — this is the project as it is on disk.
 */
export const GET: RequestHandler = async ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const listing = await listWorkspaceTree(cwd, url.searchParams.get("path") ?? "", {
    changes: (await git().status(cwd)).files,
  });
  if (!listing) error(403, "path is outside the project");

  return json(listing);
};
